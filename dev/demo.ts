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
    { id: 'visa', name: 'Visa', description: 'Residence permits, IND letters, immigration appointments' },
    { id: 'money', name: 'Money', description: 'Invoices, payments, bank statements' },
  ] satisfies LabelConfig[],
  viewInbox: true,
  viewTabs: true,
  viewSearch: true,
  viewOther: true,
};

const CRITICAL: Classification = {
  criticalProbability: 0.95,
  urgencyScore: 3,
  labels: { visa: 0.9, money: 0.9 },
};
const LATER: Classification = {
  criticalProbability: 0.6,
  urgencyScore: 2,
  labels: { visa: 0.82, money: 0.12 },
};
const CALM: Classification = {
  criticalProbability: 0.18,
  urgencyScore: 0,
  labels: { visa: 0.08, money: 0.05 },
};

const canned: Record<string, Classification> = {
  demothread000001: CRITICAL,
  demothread000002: CALM,
  demothread000003: CRITICAL,
  demothread000005: LATER,
  demothread000008: CALM,
  demothread000009: CRITICAL,
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
