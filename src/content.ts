import { CATEGORY_LABELS, threadKey, type ClassifyResult, type Classification, type EmailState } from './shared';

type Entry = {
  key: string;
  state: EmailState;
  classification?: Classification;
};

const DEBOUNCE_MS = 800;
const STORAGE_KEYS = ['apiKey', 'enabled', 'threshold'];

let section: HTMLElement | null = null;
let sectionParent: HTMLElement | null = null;
let inFlight = false;
let errorMessage: string | null = null;
let enabled = true;
let threshold = 0.7;
let debounceId: number | undefined;

const candidates = new Map<string, Entry>();

function schedule(): void {
  if (debounceId !== undefined) clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = undefined;
    void sync();
  }, DEBOUNCE_MS);
}

function isInboxView(): boolean {
  return location.hash === '' || location.hash === '#inbox' || location.hash.startsWith('#inbox?');
}

function visibleMain(): HTMLElement | undefined {
  for (const main of document.querySelectorAll<HTMLElement>('div[role=main]')) {
    const visible = window.getComputedStyle(main).display !== 'none' && main.offsetParent !== null;
    if (visible && main.querySelector('tr.zA')) return main;
  }
  return undefined;
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

function pendingEntries(): Entry[] {
  const out: Entry[] = [];
  for (const entry of candidates.values()) {
    if (entry.classification === undefined) out.push(entry);
  }
  return out;
}

async function sync(): Promise<void> {
  if (!enabled || !isInboxView()) {
    removeSection();
    candidates.clear();
    return;
  }
  const main = visibleMain();
  if (!main) {
    removeSection();
    return;
  }
  const seen = new Set<string>();
  const next = new Map<string, Entry>();
  for (const el of main.querySelectorAll<HTMLTableRowElement>('tr.zA.zE')) {
    const state = extractState(el);
    if (!state) continue;
    const key = threadKey(state);
    const entry = candidates.get(key) ?? { key, state };
    entry.state = state;
    next.set(key, entry);
    seen.add(key);
  }
  for (const key of [...candidates.keys()]) {
    if (!seen.has(key)) candidates.delete(key);
  }
  candidates.clear();
  for (const [key, entry] of next.entries()) candidates.set(key, entry);

  const first = main.querySelector<HTMLElement>('.Cp');
  if (!first || !main.contains(first)) {
    removeSection();
    return;
  }
  sectionParent = first.parentElement;
  ensureSection();
  await dispatchPending();
  render();
}

function removeSection(): void {
  section?.remove();
  section = null;
}

function ensureSection(): void {
  const existing = sectionParent?.querySelector<HTMLElement>('div#gc-critical');
  if (existing && existing.parentElement === sectionParent) {
    section = existing;
    return;
  }
  section?.remove();
  const root = document.createElement('div');
  root.className = 'gc-root';
  root.id = 'gc-critical';
  section = root;
  sectionParent?.insertBefore(root, sectionParent.firstElementChild);
}

async function dispatchPending(): Promise<void> {
  if (inFlight) return;
  if (pendingEntries().length === 0) return;
  inFlight = true;
  errorMessage = null;
  const attempted = new Set<string>();
  while (true) {
    const batch = pendingEntries()
      .filter((entry) => !attempted.has(entry.key))
      .slice(0, 20);
    if (batch.length === 0) break;
    for (const entry of batch) attempted.add(entry.key);
    let response: ClassifyResult;
    try {
      response = (await chrome.runtime.sendMessage({
        type: 'classify',
        emails: batch.map((entry) => entry.state),
      })) as ClassifyResult;
    } catch {
      errorMessage = 'Classification request failed.';
      break;
    }
    if (!response.ok) {
      errorMessage =
        response.error === 'missing_key'
          ? 'No API key saved. Open the extension popup and add it.'
          : 'Classification request failed.';
      break;
    }
    for (const entry of batch) {
      const classification = response.results[entry.key];
      if (classification !== undefined) entry.classification = classification;
    }
    if (response.errorCount > 0) {
      errorMessage = response.errorMessage ?? 'Classification request failed.';
    }
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

function render(): void {
  if (!section) return;
  const threads: Entry[] = [];
  for (const candidate of candidates.values()) {
    const classification = candidate.classification;
    if (classification !== undefined && classification.criticalProbability >= threshold) {
      threads.push(candidate);
    }
  }
  threads.sort(compareEntries);

  section.textContent = '';
  const header = document.createElement('div');
  header.className = 'gc-header';
  header.innerHTML = '<span class="gc-title">Critical</span>';
  const countEl = document.createElement('span');
  countEl.className = 'gc-count';
  countEl.textContent = String(threads.length);
  header.appendChild(countEl);
  section.appendChild(header);

  const pending = pendingEntries();
  if (inFlight && pending.length > 0) {
    const status = document.createElement('div');
    status.className = 'gc-status';
    status.textContent = `classifying ${pending.length}...`;
    section.appendChild(status);
  }
  if (errorMessage) {
    const err = document.createElement('div');
    err.className = 'gc-error';
    err.textContent = errorMessage;
    section.appendChild(err);
  }

  for (const item of threads) {
    const itemEl = document.createElement('div');
    itemEl.className = 'gc-item';

    const top = document.createElement('div');
    top.className = 'gc-top';
    const from = document.createElement('span');
    from.className = 'gc-from';
    from.textContent = item.state.fromName;
    top.appendChild(from);
    const categoryEl = document.createElement('span');
    categoryEl.className = 'gc-cat';
    categoryEl.textContent = CATEGORY_LABELS[item.classification!.category];
    top.appendChild(categoryEl);
    const dateEl = document.createElement('span');
    dateEl.className = 'gc-date';
    dateEl.textContent = item.state.date;
    top.appendChild(dateEl);
    itemEl.appendChild(top);

    const subjectEl = document.createElement('div');
    subjectEl.className = 'gc-subject';
    subjectEl.textContent = item.state.subject;
    itemEl.appendChild(subjectEl);

    const snippetEl = document.createElement('div');
    snippetEl.className = 'gc-snippet';
    snippetEl.textContent = item.state.snippet;
    itemEl.appendChild(snippetEl);

    itemEl.addEventListener('click', () => {
      location.hash = `#inbox/${item.state.legacyThreadId}`;
    });
    section.appendChild(itemEl);
  }
}

async function bootstrap(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  if (typeof stored.enabled === 'boolean') enabled = stored.enabled;
  if (typeof stored.threshold === 'number') threshold = stored.threshold;
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', schedule);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) {
        removeSection();
        return;
      }
      schedule();
      return;
    }
    if (changes.threshold && typeof changes.threshold.newValue === 'number') {
      threshold = changes.threshold.newValue;
      render();
    }
  });
  void sync();
}

bootstrap();
