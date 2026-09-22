export const VIEWS: readonly View[] = ['inbox', 'tabs', 'search', 'other'];

export type View = 'inbox' | 'tabs' | 'search' | 'other';

export type ViewSettingKey = 'viewInbox' | 'viewTabs' | 'viewSearch' | 'viewOther';

export const VIEW_SETTING_KEYS: Record<View, ViewSettingKey> = {
  inbox: 'viewInbox',
  tabs: 'viewTabs',
  search: 'viewSearch',
  other: 'viewOther',
};

export type Settings = {
  apiKey: string;
  enabled: boolean;
  threshold: number;
} & Record<ViewSettingKey, boolean>;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  enabled: true,
  threshold: 0.7,
  viewInbox: true,
  viewTabs: true,
  viewSearch: true,
  viewOther: false,
};

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
  | { ok: false; error: 'missing_key' | 'failed' };

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
