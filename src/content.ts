import {
  CONTENT_SETTING_KEYS,
  DEFAULT_SETTINGS,
  VIEWS,
  VIEW_SETTING_KEYS,
  cacheVersion,
  isClassification,
  isLabelConfig,
  isProvider,
  routeKey,
  threadKey,
  viewFromHash,
  type ClassifyResult,
  type Classification,
  type EmailState,
  type LabelConfig,
  type Provider,
  type View,
} from './shared';

type Entry = {
  key: string;
  state: EmailState;
  row: HTMLTableRowElement;
};

type Failure = {
  failureCount: number;
  nextAttemptAt: number;
};

type Anim = {
  row: HTMLTableRowElement;
  transform: string;
  transition: string;
};

type Tracked = {
  row: HTMLTableRowElement;
  index: number;
};

type Ranked = Tracked & {
  unread: boolean;
  classification: Classification | undefined;
};

const DEBOUNCE_MS = 800;
const BATCH_SIZE = 20;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 600_000;
const CHIP_HUES = 8;
const CACHE_PREFIX = 'crit:';

let bar: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let inFlight = false;
let halted = false;
let errorMessage: string | null = null;
let enabled = DEFAULT_SETTINGS.enabled;
let threshold = DEFAULT_SETTINGS.threshold;
let provider: Provider = DEFAULT_SETTINGS.provider;
let labels: LabelConfig[] = [];
let keyVersion = cacheVersion([], DEFAULT_SETTINGS.provider);
let debounceId: number | undefined;
let generation = 0;
let retryId: number | undefined;
let currentList: HTMLElement | null = null;
let orderList: HTMLElement | null = null;
let orderRoute = '';
let animateNextOrder = false;
let orderPassQueued = false;
let flipCleanupId: number | undefined;

const viewEnabled: Record<View, boolean> = {
  inbox: DEFAULT_SETTINGS.viewInbox,
  tabs: DEFAULT_SETTINGS.viewTabs,
  search: DEFAULT_SETTINGS.viewSearch,
  other: DEFAULT_SETTINGS.viewOther,
};

const candidates = new Map<string, Entry>();
const failures = new Map<string, Failure>();
const animating = new Map<HTMLTableRowElement, Anim>();
const orderIndex = new Map<string, number>();
const classifications = new Map<string, Classification>();

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
    if (classifications.has(entry.key)) continue;
    const nextAttemptAt = failures.get(entry.key)?.nextAttemptAt ?? 0;
    if (earliest === undefined || nextAttemptAt < earliest) earliest = nextAttemptAt;
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
    if (classifications.has(entry.key)) continue;
    const failure = failures.get(entry.key);
    if (failure !== undefined && failure.nextAttemptAt > now) continue;
    out.push(entry);
  }
  return out;
}

function isCriticalClassification(classification: Classification): boolean {
  return classification.criticalProbability >= threshold;
}

function recordFailure(key: string): void {
  const failure = failures.get(key) ?? { failureCount: 0, nextAttemptAt: 0 };
  failure.failureCount += 1;
  failure.nextAttemptAt =
    Date.now() + Math.min(BASE_BACKOFF_MS * 2 ** (failure.failureCount - 1), MAX_BACKOFF_MS);
  failures.set(key, failure);
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

function touchesList(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (
      currentList !== null &&
      record.target instanceof Node &&
      currentList.contains(record.target)
    ) {
      return true;
    }
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.tagName === 'TR' || node.querySelector('tr.zA') !== null) return true;
    }
  }
  return false;
}

function rowThreadId(row: HTMLTableRowElement): string | null {
  const carrier = row.querySelector('[data-thread-id]');
  return carrier?.getAttribute('data-thread-id') ?? null;
}

function cacheKeyOf(row: HTMLTableRowElement): string | null {
  const carrier = row.querySelector('[data-thread-id]');
  if (carrier === null) return null;
  const threadId = carrier.getAttribute('data-thread-id');
  const lastMessageId = carrier.getAttribute('data-legacy-last-message-id');
  if (threadId === null || lastMessageId === null) return null;
  return `${threadId}|${lastMessageId}|${keyVersion}`;
}

function classifiableUnreadKey(row: HTMLTableRowElement): string | null {
  if (!row.classList.contains('zE')) return null;
  if (row.querySelector('span.zF[email][name]') === null) return null;
  return cacheKeyOf(row);
}

function recordOrder(list: HTMLElement): void {
  const rows = [...list.querySelectorAll<HTMLTableRowElement>('tr.zA')];
  const ids = rows.map((row) => rowThreadId(row));
  const withId = ids.filter((id): id is string => id !== null);
  const knownCount = withId.filter((id) => orderIndex.has(id)).length;
  if (orderIndex.size > 0 && knownCount * 2 < withId.length) orderIndex.clear();
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
  const ranked: Ranked[] = [];
  for (const row of list.querySelectorAll<HTMLTableRowElement>('tr.zA')) {
    const id = rowThreadId(row);
    if (id === null) continue;
    const index = orderIndex.get(id);
    if (index === undefined) continue;
    const key = cacheKeyOf(row);
    ranked.push({
      row,
      index,
      unread: row.classList.contains('zE'),
      classification: key === null ? undefined : classifications.get(key),
    });
  }
  const critical: Ranked[] = [];
  const unread: Ranked[] = [];
  const read: Ranked[] = [];
  for (const item of ranked) {
    if (!item.unread) read.push(item);
    else if (item.classification !== undefined && isCriticalClassification(item.classification)) {
      critical.push(item);
    } else unread.push(item);
  }
  critical.sort((a, b) => {
    const classificationA = a.classification;
    const classificationB = b.classification;
    if (classificationA === undefined || classificationB === undefined) return 0;
    return compareClassifications(classificationA, classificationB);
  });
  unread.sort((a, b) => a.index - b.index);
  read.sort((a, b) => a.index - b.index);
  const animate =
    animateNextOrder && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  animateNextOrder = false;
  const before = animate
    ? new Map(ranked.map((item) => [item.row, item.row.getBoundingClientRect()]))
    : null;
  applyOrder([...critical, ...unread, ...read].map((item) => item.row));
  if (before !== null) flipMoved(ranked, before);
}

function finishAnimations(): void {
  clearTimeout(flipCleanupId);
  flipCleanupId = undefined;
  for (const anim of animating.values()) {
    anim.row.style.transform = anim.transform;
    anim.row.style.transition = anim.transition;
  }
  animating.clear();
}

function flipMoved(ranked: Ranked[], before: Map<HTMLTableRowElement, DOMRect>): void {
  const moved: { row: HTMLTableRowElement; dx: number; dy: number }[] = [];
  for (const item of ranked) {
    const first = before.get(item.row);
    if (first === undefined) continue;
    const last = item.row.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx === 0 && dy === 0) continue;
    moved.push({ row: item.row, dx, dy });
  }
  if (moved.length === 0) return;
  finishAnimations();
  for (const item of moved) {
    animating.set(item.row, {
      row: item.row,
      transform: item.row.style.transform,
      transition: item.row.style.transition,
    });
  }
  for (const item of moved) {
    item.row.style.transform = `translate(${item.dx}px, ${item.dy}px)`;
  }
  void document.body.offsetWidth;
  for (const item of moved) {
    const anim = animating.get(item.row);
    item.row.style.transition = 'transform 180ms';
    item.row.style.transform = anim?.transform ?? '';
  }
  flipCleanupId = window.setTimeout(() => {
    finishAnimations();
  }, 250);
}

function restoreList(list: HTMLElement | null): void {
  finishAnimations();
  if (list === null) return;
  const tracked: Tracked[] = [];
  for (const row of list.querySelectorAll<HTMLTableRowElement>('tr.zA')) {
    const id = rowThreadId(row);
    if (id === null) continue;
    const index = orderIndex.get(id);
    if (index === undefined) continue;
    tracked.push({ row, index });
  }
  tracked.sort((a, b) => a.index - b.index);
  applyOrder(tracked.map((item) => item.row));
  for (const slot of list.querySelectorAll('span.gc-chips')) slot.remove();
  observer?.takeRecords();
}

function runOrderPass(): void {
  const view = currentView();
  const list = visibleList();
  const route = routeKey(location.hash);
  if (list !== orderList || route !== orderRoute) {
    restoreList(orderList);
    orderList = list ?? null;
    orderRoute = route;
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
  recordOrder(list);
  currentList = list;
  ensureBar(list);
  render();
}

function applyOrderNow(): void {
  if (orderPassQueued) return;
  orderPassQueued = true;
  queueMicrotask(() => {
    orderPassQueued = false;
  });
  runOrderPass();
}

async function sync(): Promise<void> {
  runOrderPass();
  if (currentList === null || !dispatchAllowed()) return;
  const list = currentList;
  const seen = new Set<string>();
  const next = new Map<string, Entry>();
  for (const el of list.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
    const state = extractState(el);
    if (!state) continue;
    const key = threadKey(state, keyVersion);
    const entry = candidates.get(key) ?? { key, state, row: el };
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
  await dispatchPending();
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
  render();
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
      for (const entry of batch) recordFailure(entry.key);
      break;
    }
    if (!canDispatch(startedGeneration, startedList)) break;
    if (!response.ok) {
      errorMessage =
        response.error === 'missing_key'
          ? 'No API key saved. Open the extension popup and add it.'
          : 'Classification request failed.';
      if (response.error === 'missing_key') halted = true;
      for (const entry of batch) recordFailure(entry.key);
      break;
    }
    let applied = false;
    let authFailure = false;
    let rowFailure = false;
    for (const entry of batch) {
      const classification = response.results[entry.key];
      if (classification !== undefined) {
        classifications.set(entry.key, classification);
        failures.delete(entry.key);
        applied = true;
        continue;
      }
      rowFailure = true;
      const failure = response.errors[entry.key];
      recordFailure(entry.key);
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
    if (applied) animateNextOrder = true;
    render();
  }
  inFlight = false;
  render();
  armRetry();
}

function compareClassifications(a: Classification, b: Classification): number {
  if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
  return b.criticalProbability - a.criticalProbability;
}

function renderBar(): void {
  if (bar === null) return;
  let total = 0;
  let remaining = 0;
  if (currentList !== null) {
    for (const row of currentList.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
      const key = classifiableUnreadKey(row);
      if (key === null) continue;
      total += 1;
      if (!classifications.has(key)) remaining += 1;
    }
  }
  const status = inFlight ? remaining : 0;
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
    statusEl.textContent = `Classifying ${remaining} of ${total} unread`;
    bar.appendChild(statusEl);
    const progress = document.createElement('span');
    progress.className = 'gc-progress';
    bar.appendChild(progress);
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

function chipSignature(classification: Classification | undefined, failureCount: number): string {
  if (classification === undefined) return `p:${failureCount}`;
  let signature = `c:${isCriticalClassification(classification)}|${threshold}|${keyVersion}|`;
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
  for (const row of list.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
    const key = classifiableUnreadKey(row);
    if (key === null) continue;
    const slot = chipSlot(row);
    if (slot === null) continue;
    const classification = classifications.get(key);
    const failureCount = failures.get(key)?.failureCount ?? 0;
    const signature = chipSignature(classification, failureCount);
    if (slot.dataset.gcSig === signature) continue;
    slot.dataset.gcSig = signature;
    slot.textContent = '';
    if (classification === undefined) {
      if (failureCount > 0) {
        const pending = document.createElement('span');
        pending.className = 'gc-pending';
        pending.textContent = 'retrying';
        slot.appendChild(pending);
      } else {
        const dot = document.createElement('span');
        dot.className = 'gc-dot';
        slot.appendChild(dot);
      }
      continue;
    }
    if (isCriticalClassification(classification)) {
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
  const stored = await chrome.storage.local.get([...CONTENT_SETTING_KEYS]);
  if (typeof stored.enabled === 'boolean') enabled = stored.enabled;
  if (typeof stored.threshold === 'number') threshold = stored.threshold;
  if (isProvider(stored.provider)) provider = stored.provider;
  if (Array.isArray(stored.labels)) labels = stored.labels.filter(isLabelConfig);
  keyVersion = cacheVersion(labels, provider);
  for (const view of VIEWS) {
    const key = VIEW_SETTING_KEYS[view];
    const storedValue = stored[key];
    if (typeof storedValue === 'boolean') viewEnabled[view] = storedValue;
  }
  const allKeys =
    typeof chrome.storage.local.getKeys === 'function' ? await chrome.storage.local.getKeys() : [];
  const cacheKeys = allKeys.filter((storageKey) => storageKey.startsWith(CACHE_PREFIX));
  const cached = cacheKeys.length > 0 ? await chrome.storage.local.get(cacheKeys) : {};
  for (const [storageKey, value] of Object.entries(cached)) {
    const cacheKey = storageKey.slice(CACHE_PREFIX.length);
    if (!cacheKey.endsWith(`|${keyVersion}`)) continue;
    if (isClassification(value)) classifications.set(cacheKey, value);
  }
  observer = new MutationObserver((records) => {
    if (records.every(isOwnRecord)) return;
    if (touchesList(records)) applyOrderNow();
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => {
    generation += 1;
    finishAnimations();
    applyOrderNow();
    schedule();
  });
  chrome.storage.onChanged.addListener((changes) => {
    let structural = false;
    for (const [storageKey, change] of Object.entries(changes)) {
      if (!storageKey.startsWith(CACHE_PREFIX)) continue;
      const cacheKey = storageKey.slice(CACHE_PREFIX.length);
      if (!cacheKey.endsWith(`|${keyVersion}`)) continue;
      if (isClassification(change.newValue)) {
        classifications.set(cacheKey, change.newValue);
        failures.delete(cacheKey);
      } else {
        classifications.delete(cacheKey);
        failures.delete(cacheKey);
      }
    }
    if (changes.apiKey || changes.typesafeApiKey) {
      halted = false;
      failures.clear();
    }
    if (changes.provider) {
      provider = isProvider(changes.provider.newValue)
        ? changes.provider.newValue
        : DEFAULT_SETTINGS.provider;
      keyVersion = cacheVersion(labels, provider);
      classifications.clear();
      failures.clear();
      halted = false;
      structural = true;
    }
    if (changes.labels) {
      const value = changes.labels.newValue;
      labels = Array.isArray(value) ? value.filter(isLabelConfig) : [];
      keyVersion = cacheVersion(labels, provider);
      candidates.clear();
      classifications.clear();
      failures.clear();
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
