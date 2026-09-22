export const VIEWS: readonly View[] = ['inbox', 'tabs', 'search', 'other'];

export type View = 'inbox' | 'tabs' | 'search' | 'other';

export type ViewSettingKey = 'viewInbox' | 'viewTabs' | 'viewSearch' | 'viewOther';

export const VIEW_SETTING_KEYS: Record<View, ViewSettingKey> = {
  inbox: 'viewInbox',
  tabs: 'viewTabs',
  search: 'viewSearch',
  other: 'viewOther',
};

export type Provider = 'gateway' | 'typesafe';

export function isProvider(value: unknown): value is Provider {
  return value === 'gateway' || value === 'typesafe';
}

export type Settings = {
  apiKey: string;
  typesafeApiKey: string;
  provider: Provider;
  enabled: boolean;
  threshold: number;
  privacyAck: boolean;
} & Record<ViewSettingKey, boolean>;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  typesafeApiKey: '',
  provider: 'gateway',
  enabled: true,
  threshold: 0.7,
  privacyAck: false,
  viewInbox: true,
  viewTabs: true,
  viewSearch: true,
  viewOther: false,
};

export const SETTING_KEYS = [
  'apiKey',
  'typesafeApiKey',
  'provider',
  'enabled',
  'threshold',
  'privacyAck',
  'labels',
  ...VIEWS.map((view) => VIEW_SETTING_KEYS[view]),
] as const;

export const CONTENT_SETTING_KEYS = SETTING_KEYS.filter(
  (key) => key !== 'apiKey' && key !== 'typesafeApiKey'
);

export type LabelConfig = { id: string; name: string; description: string };

export const MAX_LABELS = 15;

export type EmailState = {
  threadId: string;
  legacyThreadId: string;
  lastMessageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
};

export type Classification = {
  criticalProbability: number;
  urgencyScore: number;
  labels: Record<string, number>;
};

export type ClassifyError = { message: string; status?: number };

export type ClassifyMessage = {
  type: 'classify';
  emails: EmailState[];
  labels: LabelConfig[];
};

export type ClassifyResult =
  | {
      ok: true;
      results: Record<string, Classification>;
      errors: Record<string, ClassifyError>;
    }
  | { ok: false; error: 'missing_key' | 'failed' | 'needs_ack' };

export type TestMessage = { type: 'test' };

export type TestResult = { ok: true } | { ok: false; message: string };

export function labelsHash(labels: LabelConfig[]): string {
  let h = 5381;
  for (const label of labels) {
    const s = `${label.id}|${label.name}|${label.description}`;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function threadKey(state: EmailState, version: string): string {
  return `${state.threadId}|${state.lastMessageId}|${version}`;
}

export function cacheVersion(labels: LabelConfig[], provider: Provider): string {
  return `${provider}:${labelsHash(labels)}`;
}

export function isEmailState(value: unknown): value is EmailState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.threadId === 'string' &&
    typeof v.legacyThreadId === 'string' &&
    typeof v.lastMessageId === 'string' &&
    typeof v.fromName === 'string' &&
    typeof v.fromEmail === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.snippet === 'string' &&
    typeof v.date === 'string'
  );
}

export function isLabelConfig(value: unknown): value is LabelConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.description === 'string'
  );
}

export function isClassification(value: unknown): value is Classification {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.criticalProbability !== 'number') return false;
  if (typeof v.urgencyScore !== 'number') return false;
  const labels = v.labels;
  if (typeof labels !== 'object' || labels === null) return false;
  return Object.values(labels).every((probability) => typeof probability === 'number');
}

const THREAD_ID = /^[A-Za-z0-9]{16,}$/;

const TWO_SEGMENT_LIST_HEADS: Record<string, true> = {
  search: true,
  'advanced-search': true,
  label: true,
  category: true,
};

function parseHash(hash: string): { raw: string[]; decoded: string[] } {
  const raw = hash
    .replace(/^#/, '')
    .split('?')[0]
    .split('/')
    .filter((part) => part.length > 0);
  const decoded = raw.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  return { raw, decoded };
}

function threadIndex(parts: string[]): number {
  const last = parts.length - 1;
  if (last < 1 || !THREAD_ID.test(parts[last])) return -1;
  if (TWO_SEGMENT_LIST_HEADS[parts[0]] === true) return parts.length >= 3 ? last : -1;
  return last;
}

export function viewFromHash(hash: string): View | null {
  const { decoded } = parseHash(hash);
  if (decoded.length === 0) return 'inbox';
  if (threadIndex(decoded) !== -1) return null;
  const head = decoded[0];
  if (head === 'inbox') return 'inbox';
  if (head === 'category') return 'tabs';
  if (head === 'search' || head === 'advanced-search') return 'search';
  return 'other';
}

export function routeKey(hash: string): string {
  const queryAt = hash.indexOf('?');
  const query = queryAt === -1 ? '' : hash.slice(queryAt + 1);
  const { decoded } = parseHash(hash);
  const index = threadIndex(decoded);
  const parts = index === -1 ? decoded : decoded.slice(0, index);
  const route = parts.length === 0 ? 'inbox' : parts.join('/');
  return query.length === 0 ? route : `${route}?${query}`;
}
