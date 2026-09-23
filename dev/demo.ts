import {
  cacheVersion,
  threadKey,
  type Classification,
  type EmailState,
  type LabelConfig,
} from '../src/shared';

type DemoStore = Record<string, unknown>;

const params = new URLSearchParams(location.search);
const acked = params.get('ack') !== '0';

const store: DemoStore = {
  provider: 'gateway',
  apiKey: 'demo',
  typesafeApiKey: '',
  enabled: true,
  threshold: 0.7,
  privacyAck: acked,
  labels: [
    {
      id: 'visa',
      name: 'Visa',
      description: 'Residence permits, IND letters, immigration appointments',
    },
    { id: 'money', name: 'Money', description: 'Invoices, payments, bank statements' },
    { id: 'home', name: 'Home', description: 'Rent, utilities, landlord and building notices' },
  ] satisfies LabelConfig[],
  viewInbox: true,
  viewTabs: true,
  viewSearch: true,
  viewOther: true,
};

const RESIDENCE: Classification = {
  criticalProbability: 0.94,
  urgencyScore: 3,
  labels: { visa: 0.92, money: 0.05, home: 0.03 },
};
const INVOICE: Classification = {
  criticalProbability: 0.89,
  urgencyScore: 3,
  labels: { visa: 0.04, money: 0.94, home: 0.05 },
};
const PASSPORT: Classification = {
  criticalProbability: 0.87,
  urgencyScore: 3,
  labels: { visa: 0.95, money: 0.03, home: 0.04 },
};
const RENT: Classification = {
  criticalProbability: 0.31,
  urgencyScore: 1,
  labels: { visa: 0.02, money: 0.11, home: 0.9 },
};
const LIBRARY: Classification = {
  criticalProbability: 0.19,
  urgencyScore: 1,
  labels: { visa: 0.03, money: 0.04, home: 0.06 },
};
const NEWSLETTER: Classification = {
  criticalProbability: 0.08,
  urgencyScore: 0,
  labels: { visa: 0.01, money: 0.02, home: 0.02 },
};

const canned: Record<string, Classification> = {
  demothread000001: RESIDENCE,
  demothread000002: NEWSLETTER,
  demothread000003: INVOICE,
  demothread000005: LIBRARY,
  demothread000008: RENT,
  demothread000009: PASSPORT,
};

const listeners: unknown[] = [];

function isClassifyMessage(
  value: unknown
): value is { type: 'classify'; emails: EmailState[]; labels: LabelConfig[] } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || value.type !== 'classify') return false;
  if (!('emails' in value) || !Array.isArray(value.emails)) return false;
  if (!('labels' in value) || !Array.isArray(value.labels)) return false;
  return true;
}

async function respond(message: unknown): Promise<unknown> {
  if (!isClassifyMessage(message)) return { ok: true };
  if (!acked) return { ok: false, error: 'needs_ack' };
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 300);
  await promise;
  const version = cacheVersion(message.labels, 'gateway');
  const results: Record<string, Classification> = {};
  for (const email of message.emails) {
    const classification = canned[email.threadId];
    if (classification !== undefined) results[threadKey(email, version)] = classification;
  }
  return { ok: true, results, errors: {} };
}

Object.assign(window, {
  chrome: {
    storage: {
      local: {
        get: async (keys?: string[] | null) => {
          if (keys === null || keys === undefined) return { ...store };
          const out: DemoStore = {};
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (items: DemoStore) => {
          Object.assign(store, items);
        },
        remove: async () => {},
        getKeys: async () => Object.keys(store),
      },
      onChanged: {
        addListener: (listener: unknown) => {
          listeners.push(listener);
        },
      },
    },
    runtime: {
      sendMessage: respond,
      getManifest: () => ({ version: '0.1.0' }),
    },
  },
});

const gmailOrder = [
  ...document.querySelectorAll<HTMLTableRowElement>('.Cp tbody tr.zA'),
].map((row) => (row.querySelector('span.bqe')?.textContent ?? '').replace(/\s+/g, ' ').trim());
const opened = document.getElementById('demo-opened');

document.addEventListener('click', (event) => {
  const target = event.target;
  const row = target instanceof Element ? target.closest('tr.zA') : null;
  if (!(row instanceof HTMLTableRowElement)) return;
  const tbody = row.parentElement;
  const rows = tbody === null ? [] : [...tbody.querySelectorAll<HTMLTableRowElement>('tr.zA')];
  const index = rows.indexOf(row);
  const subject = index === -1 ? undefined : gmailOrder[index];
  if (opened !== null) opened.textContent = `Opened: ${subject ?? 'unknown'}`;
});
