import {
  DEFAULT_SETTINGS,
  VIEWS,
  VIEW_SETTING_KEYS,
  isLabelConfig,
  labelsHash,
  threadKey,
  viewFromHash,
  type ClassifyResult,
  type Classification,
  type EmailState,
  type LabelConfig,
  type View,
} from './shared';

type Entry = {
  key: string;
  state: EmailState;
  row: HTMLTableRowElement;
  classification?: Classification;
  failureCount: number;
  nextAttemptAt: number;
};

type Tracked = {
  row: HTMLTableRowElement;
  index: number;
  entry: Entry | undefined;
};

const DEBOUNCE_MS = 800;
const BATCH_SIZE = 20;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 600_000;
const CHIP_HUES = 8;
const STORAGE_KEYS = [
  'enabled',
  'threshold',
  'labels',
  ...VIEWS.map((view) => VIEW_SETTING_KEYS[view]),
];

let bar: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let inFlight = false;
let halted = false;
let errorMessage: string | null = null;
let enabled = DEFAULT_SETTINGS.enabled;
let threshold = DEFAULT_SETTINGS.threshold;
let labels: LabelConfig[] = [];
let labelsVersion = labelsHash([]);
let debounceId: number | undefined;
let generation = 0;
let retryId: number | undefined;
let currentList: HTMLElement | null = null;
let orderList: HTMLElement | null = null;

const viewEnabled: Record<View, boolean> = {
  inbox: DEFAULT_SETTINGS.viewInbox,
  tabs: DEFAULT_SETTINGS.viewTabs,
  search: DEFAULT_SETTINGS.viewSearch,
  other: DEFAULT_SETTINGS.viewOther,
};

const candidates = new Map<string, Entry>();
const orderIndex = new Map<string, number>();

function schedule(): void {
  clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = undefined;
    void sync();
  }, DEBOUNCE_MS);
}

function clearRetry(): void {
  if (retryId !== undefined) {
    clearTimeout(retryId);
    retryId = undefined;
  }
}

function armRetry(): void {
  clearRetry();
  if (halted || !dispatchAllowed()) return;
  const now = Date.now();
  let earliest: number | undefined;
  for (const entry of candidates.values()) {
    if (entry.classification !== undefined) continue;
    if (earliest === undefined || entry.nextAttemptAt < earliest) earliest = entry.nextAttemptAt;
  }
  if (earliest === undefined) return;
  retryId = window.setTimeout(() => {
    retryId = undefined;
    void dispatchPending();
  }, Math.max(0, earliest - now));
}

function dispatchAllowed(): boolean {
  const view = currentView();
  return enabled && view !== null && viewEnabled[view];
}

function canDispatch(startedGeneration: number, startedList: HTMLElement | undefined): boolean {
  if (startedGeneration !== generation) return false;
  if (!dispatchAllowed()) return false;
  return visibleList() === startedList;
}

function visibleMain(): HTMLElement | undefined {
  for (const main of document.querySelectorAll<HTMLElement>('div[role=main]')) {
    const visible = window.getComputedStyle(main).display !== 'none' && main.offsetParent !== null;
    if (visible && main.querySelector('tr.zA')) return main;
  }
  return undefined;
}

function visibleList(): HTMLElement | undefined {
  const main = visibleMain();
  if (!main) return undefined;
  for (const list of main.querySelectorAll<HTMLElement>('.Cp')) {
    if (!list.querySelector('tr.zA')) continue;
    if (list.offsetParent === null && list.getClientRects().length === 0) continue;
    return list;
  }
  return undefined;
}

function currentView(): View | null {
  if (!visibleMain()) return null;
  return viewFromHash(location.hash);
}

function extractState(row: HTMLTableRowElement): EmailState | undefined {
  const sender = row.querySelector('span.zF[email][name]');
  const subjectEl = row.querySelector('span.bqe[data-thread-id]');
  if (!sender || !subjectEl) return undefined;
  const threadId = subjectEl.getAttribute('data-thread-id');
  const legacyThreadId = subjectEl.getAttribute('data-legacy-thread-id');
  const lastMessageId = subjectEl.getAttribute('data-legacy-last-message-id');
  if (!threadId || !legacyThreadId || !lastMessageId) return undefined;
  const snippetEl = row.querySelector('span.y2');
  let snippet = '';
  if (snippetEl) {
    const clone = snippetEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('span.Zt').forEach((el) => el.remove());
    snippet = clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
  const dateEl = row.querySelector('td.xW span[title]');
  const date = dateEl?.getAttribute('title') ?? row.querySelector('td.xW')?.textContent?.trim() ?? '';
  return {
    threadId,
    legacyThreadId,
    lastMessageId,
    fromName: sender.getAttribute('name') ?? '',
    fromEmail: sender.getAttribute('email') ?? '',
    subject: (subjectEl.textContent ?? '').replace(/\s+/g, ' ').trim(),
    snippet,
    date,
  };
}

function dispatchableEntries(): Entry[] {
  const now = Date.now();
  const out: Entry[] = [];
  for (const entry of candidates.values()) {
    if (entry.classification === undefined && entry.nextAttemptAt <= now) out.push(entry);
  }
  return out;
}

function pendingCount(): number {
  let count = 0;
  for (const entry of candidates.values()) {
    if (entry.classification === undefined) count += 1;
  }
  return count;
}

function isCritical(entry: Entry): boolean {
  const classification = entry.classification;
  return classification !== undefined && classification.criticalProbability >= threshold;
}

function recordFailure(entry: Entry): void {
  entry.failureCount += 1;
  entry.nextAttemptAt =
    Date.now() + Math.min(BASE_BACKOFF_MS * 2 ** (entry.failureCount - 1), MAX_BACKOFF_MS);
}

function isGcNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  for (const className of node.classList) {
    if (className.startsWith('gc-')) return true;
  }
  return node.closest('.gc-root, .gc-chips') !== null;
}

function isOwnRecord(record: MutationRecord): boolean {
  if (bar !== null && (record.target === bar || bar.contains(record.target))) return true;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  if (nodes.length === 0) return false;
  return nodes.every(isGcNode);
}

function rowThreadId(row: HTMLTableRowElement): string | null {
  const carrier = row.querySelector('[data-thread-id]');
  return carrier?.getAttribute('data-thread-id') ?? null;
}

function recordOrder(list: HTMLElement): void {
  const rows = [...list.querySelectorAll<HTMLTableRowElement>('tr.zA')];
  const ids = rows.map((row) => rowThreadId(row));
  const known = new Set(orderIndex.keys());
  for (let i = 0; i < rows.length; i++) {
    const id = ids[i];
    if (id === null || known.has(id)) continue;
    let prev: number | undefined;
    for (let j = i - 1; j >= 0 && prev === undefined; j--) {
      const other = ids[j];
      if (other === null || !known.has(other)) continue;
      prev = orderIndex.get(other);
    }
    let next: number | undefined;
    for (let j = i + 1; j < rows.length && next === undefined; j++) {
      const other = ids[j];
      if (other === null || !known.has(other)) continue;
      next = orderIndex.get(other);
    }
    if (prev === undefined && next === undefined) orderIndex.set(id, 0);
    else if (prev === undefined) orderIndex.set(id, (next as number) - 1);
    else if (next === undefined) orderIndex.set(id, prev + 1);
    else orderIndex.set(id, (prev + next) / 2);
    known.add(id);
  }
}

function applyOrder(rows: HTMLTableRowElement[]): void {
  if (rows.length === 0) return;
  const parent = rows[0].parentElement;
  if (parent === null) return;
  const targets = rows.filter((row) => row.parentElement === parent);
  let ref = parent.firstElementChild;
  for (const row of targets) {
    if (row === ref) {
      ref = ref.nextElementSibling;
    } else {
      parent.insertBefore(row, ref);
    }
  }
}

function applyRowOrder(): void {
  const list = currentList;
  if (list === null) return;
  const entryByRow = new Map<HTMLTableRowElement, Entry>();
  for (const entry of candidates.values()) entryByRow.set(entry.row, entry);
  const tracked: Tracked[] = [];
  for (const row of list.querySelectorAll<HTMLTableRowElement>('tr.zA')) {
    const id = rowThreadId(row);
    if (id === null) continue;
    const index = orderIndex.get(id);
    if (index === undefined) continue;
    tracked.push({ row, index, entry: entryByRow.get(row) });
  }
  const critical: Tracked[] = [];
  const unread: Tracked[] = [];
  const read: Tracked[] = [];
  for (const item of tracked) {
    if (item.entry === undefined) read.push(item);
    else if (isCritical(item.entry)) critical.push(item);
    else unread.push(item);
  }
  critical.sort((a, b) => {
    const entryA = a.entry;
    const entryB = b.entry;
    if (entryA === undefined || entryB === undefined) return 0;
    return compareEntries(entryA, entryB);
  });
  unread.sort((a, b) => a.index - b.index);
  read.sort((a, b) => a.index - b.index);
  applyOrder([...critical, ...unread, ...read].map((item) => item.row));
}

function restoreList(list: HTMLElement | null): void {
  if (list === null) return;
  const tracked: Tracked[] = [];
  for (const row of list.querySelectorAll<HTMLTableRowElement>('tr.zA')) {
    const id = rowThreadId(row);
    if (id === null) continue;
    const index = orderIndex.get(id);
    if (index === undefined) continue;
    tracked.push({ row, index, entry: undefined });
  }
  tracked.sort((a, b) => a.index - b.index);
  applyOrder(tracked.map((item) => item.row));
  for (const slot of list.querySelectorAll('span.gc-chips')) slot.remove();
  observer?.takeRecords();
}

async function sync(): Promise<void> {
  const view = currentView();
  const list = visibleList();
  if (list !== orderList) {
    restoreList(orderList);
    orderList = list ?? null;
    orderIndex.clear();
  }
  if (!enabled || view === null || !viewEnabled[view] || !list) {
    restoreList(orderList);
    orderList = null;
    orderIndex.clear();
    removeBar();
    candidates.clear();
    currentList = null;
    return;
  }
  const seen = new Set<string>();
  const next = new Map<string, Entry>();
  for (const el of list.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
    const state = extractState(el);
    if (!state) continue;
    const key = threadKey(state, labelsVersion);
    const entry = candidates.get(key) ?? { key, state, row: el, failureCount: 0, nextAttemptAt: 0 };
    entry.state = state;
    entry.row = el;
    next.set(key, entry);
    seen.add(key);
  }
  for (const key of [...candidates.keys()]) {
    if (!seen.has(key)) candidates.delete(key);
  }
  candidates.clear();
  for (const [key, entry] of next.entries()) candidates.set(key, entry);

  recordOrder(list);
  currentList = list;
  ensureBar(list);
  render();
  await dispatchPending();
  render();
}

function removeBar(): void {
  bar?.remove();
  bar = null;
  clearRetry();
  observer?.takeRecords();
}

function ensureBar(list: HTMLElement): void {
  const parent = list.parentElement;
  if (!parent) {
    removeBar();
    return;
  }
  if (bar !== null && !bar.isConnected) bar = null;
  if (bar !== null && bar.parentElement === parent && bar.nextElementSibling === list) {
    return;
  }
  if (bar === null) {
    const root = document.createElement('div');
    root.className = 'gc-root';
    root.id = 'gc-unread';
    bar = root;
  }
  parent.insertBefore(bar, list);
  observer?.takeRecords();
}

async function dispatchPending(): Promise<void> {
  if (inFlight) return;
  if (halted || !dispatchAllowed()) {
    clearRetry();
    return;
  }
  if (dispatchableEntries().length === 0) {
    armRetry();
    return;
  }
  inFlight = true;
  errorMessage = null;
  const startedGeneration = generation;
  const startedList = visibleList();
  const attempted = new Set<string>();
  while (true) {
    if (!canDispatch(startedGeneration, startedList)) break;
    const batch = dispatchableEntries()
      .filter((entry) => !attempted.has(entry.key))
      .slice(0, BATCH_SIZE);
    if (batch.length === 0) break;
    for (const entry of batch) attempted.add(entry.key);
    let response: ClassifyResult;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'classify',
        emails: batch.map((entry) => entry.state),
        labels,
      });
    } catch {
      if (!canDispatch(startedGeneration, startedList)) break;
      errorMessage = 'Classification request failed.';
      for (const entry of batch) recordFailure(entry);
      break;
    }
    if (!canDispatch(startedGeneration, startedList)) break;
    if (!response.ok) {
      errorMessage =
        response.error === 'missing_key'
          ? 'No API key saved. Open the extension popup and add it.'
          : 'Classification request failed.';
      if (response.error === 'missing_key') halted = true;
      for (const entry of batch) recordFailure(entry);
      break;
    }
    let authFailure = false;
    let rowFailure = false;
    for (const entry of batch) {
      const classification = response.results[entry.key];
      if (classification !== undefined) {
        entry.classification = classification;
        entry.failureCount = 0;
        entry.nextAttemptAt = 0;
        continue;
      }
      rowFailure = true;
      const failure = response.errors[entry.key];
      recordFailure(entry);
      if (failure !== undefined && (failure.status === 401 || failure.status === 403)) {
        authFailure = true;
      }
    }
    if (authFailure) {
      halted = true;
      errorMessage = 'Classification failed with 401/403. Check the API key in the popup.';
    } else if (rowFailure) {
      errorMessage = 'Classification request failed.';
    }
    render();
  }
  inFlight = false;
  render();
  armRetry();
}

function compareEntries(a: Entry, b: Entry): number {
  const ua = a.classification?.urgencyScore ?? 0;
  const ub = b.classification?.urgencyScore ?? 0;
  if (ub !== ua) return ub - ua;
  const pa = a.classification?.criticalProbability ?? 0;
  const pb = b.classification?.criticalProbability ?? 0;
  return pb - pa;
}

function renderBar(): void {
  if (bar === null) return;
  const total = candidates.size;
  const pending = pendingCount();
  const status = inFlight && pending > 0 ? pending : 0;
  const signature = `${total}|${status}|${errorMessage ?? ''}`;
  if (bar.dataset.gcSig === signature) return;
  bar.dataset.gcSig = signature;
  bar.textContent = '';
  const count = document.createElement('span');
  count.className = 'gc-count';
  count.textContent = `${total} unread`;
  bar.appendChild(count);
  if (status > 0) {
    const statusEl = document.createElement('span');
    statusEl.className = 'gc-status';
    statusEl.textContent = `classifying ${status}...`;
    bar.appendChild(statusEl);
  }
  if (errorMessage) {
    const err = document.createElement('span');
    err.className = 'gc-error';
    err.textContent = errorMessage;
    bar.appendChild(err);
  }
}

function chipSlot(row: HTMLTableRowElement): HTMLElement | null {
  const existing = row.querySelector<HTMLElement>('span.gc-chips');
  if (existing) return existing;
  const container = row.querySelector('.y6');
  const subject =
    row.querySelector('span.bog') ?? row.querySelector('span.bqe[data-thread-id]');
  const slot = document.createElement('span');
  slot.className = 'gc-chips';
  if (container !== null) container.insertBefore(slot, container.firstChild);
  else if (subject?.parentElement != null) subject.parentElement.insertBefore(slot, subject);
  else return null;
  return slot;
}

function chipSignature(entry: Entry): string {
  const classification = entry.classification;
  if (classification === undefined) return `p:${entry.failureCount}`;
  let signature = `c:${isCritical(entry)}|${threshold}|${labelsVersion}|`;
  for (const label of labels) {
    const probability = classification.labels[label.id];
    if (probability === undefined || probability < threshold) continue;
    signature += `${label.id}:${probability},`;
  }
  return signature;
}

function renderChips(): void {
  const list = currentList;
  if (list === null) return;
  for (const stale of list.querySelectorAll('tr.zA:not(.zE) span.gc-chips')) stale.remove();
  for (const entry of candidates.values()) {
    if (!entry.row.isConnected) continue;
    const slot = chipSlot(entry.row);
    if (slot === null) continue;
    const signature = chipSignature(entry);
    if (slot.dataset.gcSig === signature) continue;
    slot.dataset.gcSig = signature;
    slot.textContent = '';
    const classification = entry.classification;
    if (classification === undefined) {
      const pending = document.createElement('span');
      pending.className = 'gc-pending';
      pending.textContent = entry.failureCount > 0 ? 'retrying' : 'classifying';
      slot.appendChild(pending);
      continue;
    }
    if (isCritical(entry)) {
      const badge = document.createElement('span');
      badge.className = 'gc-badge';
      badge.textContent = 'Critical';
      slot.appendChild(badge);
    }
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      const probability = classification.labels[label.id];
      if (probability === undefined || probability < threshold) continue;
      const chip = document.createElement('span');
      chip.className = `gc-chip gc-hue-${index % CHIP_HUES}`;
      chip.textContent = label.name;
      slot.appendChild(chip);
    }
  }
}

function render(): void {
  if (bar === null) return;
  renderBar();
  renderChips();
  applyRowOrder();
  observer?.takeRecords();
}

async function bootstrap(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  if (typeof stored.enabled === 'boolean') enabled = stored.enabled;
  if (typeof stored.threshold === 'number') threshold = stored.threshold;
  if (Array.isArray(stored.labels)) labels = stored.labels.filter(isLabelConfig);
  labelsVersion = labelsHash(labels);
  for (const view of VIEWS) {
    const key = VIEW_SETTING_KEYS[view];
    const storedValue = stored[key];
    if (typeof storedValue === 'boolean') viewEnabled[view] = storedValue;
  }
  observer = new MutationObserver((records) => {
    if (records.every(isOwnRecord)) return;
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => {
    generation += 1;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes) => {
    let structural = false;
    if (changes.apiKey) {
      halted = false;
      for (const entry of candidates.values()) {
        entry.failureCount = 0;
        entry.nextAttemptAt = 0;
      }
    }
    if (changes.labels) {
      const value = changes.labels.newValue;
      labels = Array.isArray(value) ? value.filter(isLabelConfig) : [];
      labelsVersion = labelsHash(labels);
      candidates.clear();
      structural = true;
    }
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      structural = true;
    }
    if (changes.threshold && typeof changes.threshold.newValue === 'number') {
      threshold = changes.threshold.newValue;
    }
    for (const view of VIEWS) {
      const key = VIEW_SETTING_KEYS[view];
      const change = changes[key];
      if (!change) continue;
      viewEnabled[view] =
        typeof change.newValue === 'boolean' ? change.newValue : DEFAULT_SETTINGS[key];
      structural = true;
    }
    if (structural) generation += 1;
    schedule();
  });
  void sync();
}

bootstrap();
