import {
  DEFAULT_SETTINGS,
  VIEWS,
  VIEW_SETTING_KEYS,
  isLabelConfig,
  labelsHash,
  threadHash,
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
  classification?: Classification;
  failureCount: number;
  nextAttemptAt: number;
};

const DEBOUNCE_MS = 800;
const BATCH_SIZE = 20;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 600_000;
const CHIP_COLORS = 8;
const STORAGE_KEYS = [
  'enabled',
  'threshold',
  'labels',
  ...VIEWS.map((view) => VIEW_SETTING_KEYS[view]),
];

let section: HTMLElement | null = null;
let inFlight = false;
let halted = false;
let errorMessage: string | null = null;
let enabled = DEFAULT_SETTINGS.enabled;
let threshold = DEFAULT_SETTINGS.threshold;
let labels: LabelConfig[] = [];
let labelsVersion = labelsHash([]);
let lastSignature: string | null = null;
let debounceId: number | undefined;

const viewEnabled: Record<View, boolean> = {
  inbox: DEFAULT_SETTINGS.viewInbox,
  tabs: DEFAULT_SETTINGS.viewTabs,
  search: DEFAULT_SETTINGS.viewSearch,
  other: DEFAULT_SETTINGS.viewOther,
};

const candidates = new Map<string, Entry>();

function schedule(): void {
  clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = undefined;
    void sync();
  }, DEBOUNCE_MS);
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

function isOwnRecord(record: MutationRecord): boolean {
  if (section === null) return false;
  if (record.target === section || section.contains(record.target)) return true;
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (node === section || section.contains(node)) return true;
  }
  return false;
}

async function sync(): Promise<void> {
  const view = currentView();
  if (!enabled || view === null || !viewEnabled[view]) {
    removeSection();
    candidates.clear();
    return;
  }
  const list = visibleList();
  if (!list) {
    removeSection();
    candidates.clear();
    return;
  }
  const seen = new Set<string>();
  const next = new Map<string, Entry>();
  for (const el of list.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
    const state = extractState(el);
    if (!state) continue;
    const key = threadKey(state, labelsVersion);
    const entry = candidates.get(key) ?? { key, state, failureCount: 0, nextAttemptAt: 0 };
    entry.state = state;
    next.set(key, entry);
    seen.add(key);
  }
  for (const key of [...candidates.keys()]) {
    if (!seen.has(key)) candidates.delete(key);
  }
  candidates.clear();
  for (const [key, entry] of next.entries()) candidates.set(key, entry);

  ensureSection(list);
  render();
  await dispatchPending();
  render();
}

function removeSection(): void {
  section?.remove();
  section = null;
  lastSignature = null;
}

function ensureSection(list: HTMLElement): void {
  const parent = list.parentElement;
  if (!parent) {
    removeSection();
    return;
  }
  if (section !== null && !section.isConnected) section = null;
  if (section !== null && section.parentElement === parent && section.nextElementSibling === list) {
    return;
  }
  if (section === null) {
    const root = document.createElement('div');
    root.className = 'gc-root';
    root.id = 'gc-unread';
    section = root;
  }
  parent.insertBefore(section, list);
}

async function dispatchPending(): Promise<void> {
  if (inFlight || halted) return;
  if (dispatchableEntries().length === 0) return;
  inFlight = true;
  errorMessage = null;
  const attempted = new Set<string>();
  while (true) {
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
      errorMessage = 'Classification request failed.';
      for (const entry of batch) recordFailure(entry);
      break;
    }
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
}

function compareEntries(a: Entry, b: Entry): number {
  const ua = a.classification?.urgencyScore ?? 0;
  const ub = b.classification?.urgencyScore ?? 0;
  if (ub !== ua) return ub - ua;
  const pa = a.classification?.criticalProbability ?? 0;
  const pb = b.classification?.criticalProbability ?? 0;
  return pb - pa;
}

function renderSignature(entries: Entry[]): string {
  const parts = entries.map((entry) => {
    const classification = entry.classification;
    if (classification === undefined) return `${entry.key}?${entry.failureCount}`;
    return `${entry.key}=${classification.criticalProbability},${classification.urgencyScore},${JSON.stringify(classification.labels)}`;
  });
  return [threshold, labelsVersion, inFlight, errorMessage ?? '', ...parts].join('|');
}

function itemElement(entry: Entry): HTMLElement {
  const classification = entry.classification;
  const itemEl = document.createElement('div');
  itemEl.className = 'gc-item';

  const top = document.createElement('div');
  top.className = 'gc-top';
  const from = document.createElement('span');
  from.className = 'gc-from';
  from.textContent = entry.state.fromName;
  top.appendChild(from);

  if (isCritical(entry)) {
    const badge = document.createElement('span');
    badge.className = 'gc-badge';
    badge.textContent = 'Critical';
    top.appendChild(badge);
  }

  if (classification === undefined) {
    const marker = document.createElement('span');
    marker.className = 'gc-pending';
    marker.textContent = entry.failureCount > 0 ? 'retrying' : 'classifying';
    top.appendChild(marker);
  } else {
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      const probability = classification.labels[label.id];
      if (probability === undefined || probability < threshold) continue;
      const chip = document.createElement('span');
      chip.className = `gc-chip gc-chip-${index % CHIP_COLORS}`;
      chip.textContent = label.name;
      top.appendChild(chip);
    }
  }

  const date = document.createElement('span');
  date.className = 'gc-date';
  date.textContent = entry.state.date;
  top.appendChild(date);
  itemEl.appendChild(top);

  const subject = document.createElement('div');
  subject.className = 'gc-subject';
  subject.textContent = entry.state.subject;
  itemEl.appendChild(subject);

  const snippet = document.createElement('div');
  snippet.className = 'gc-snippet';
  snippet.textContent = entry.state.snippet;
  itemEl.appendChild(snippet);

  itemEl.addEventListener('click', () => {
    location.hash = threadHash(location.hash, entry.state.legacyThreadId);
  });
  return itemEl;
}

function render(): void {
  if (section === null) return;
  const entries = [...candidates.values()];
  const critical: Entry[] = [];
  const rest: Entry[] = [];
  for (const entry of entries) {
    if (isCritical(entry)) critical.push(entry);
    else rest.push(entry);
  }
  critical.sort(compareEntries);

  const signature = renderSignature(entries);
  if (signature === lastSignature) return;
  lastSignature = signature;

  section.textContent = '';
  const header = document.createElement('div');
  header.className = 'gc-header';
  const title = document.createElement('span');
  title.className = 'gc-title';
  title.textContent = 'Unread';
  header.appendChild(title);
  const countEl = document.createElement('span');
  countEl.className = 'gc-count';
  countEl.textContent = String(entries.length);
  header.appendChild(countEl);
  section.appendChild(header);

  const pending = pendingCount();
  if (inFlight && pending > 0) {
    const status = document.createElement('div');
    status.className = 'gc-status';
    status.textContent = `classifying ${pending}...`;
    section.appendChild(status);
  }
  if (errorMessage) {
    const err = document.createElement('div');
    err.className = 'gc-error';
    err.textContent = errorMessage;
    section.appendChild(err);
  }

  for (const entry of critical) section.appendChild(itemElement(entry));
  for (const entry of rest) section.appendChild(itemElement(entry));
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
  const observer = new MutationObserver((records) => {
    if (records.every(isOwnRecord)) return;
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', schedule);
  chrome.storage.onChanged.addListener((changes) => {
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
    }
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.threshold && typeof changes.threshold.newValue === 'number') {
      threshold = changes.threshold.newValue;
    }
    for (const view of VIEWS) {
      const key = VIEW_SETTING_KEYS[view];
      const change = changes[key];
      if (!change) continue;
      viewEnabled[view] =
        typeof change.newValue === 'boolean' ? change.newValue : DEFAULT_SETTINGS[key];
    }
    schedule();
  });
  void sync();
}

bootstrap();
