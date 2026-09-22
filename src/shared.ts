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

export type Category =
  | 'needs_reply'
  | 'money_or_legal'
  | 'deadline'
  | 'security'
  | 'fyi'
  | 'promo';

export const CATEGORY_LABELS: Record<Category, string> = {
  needs_reply: 'Reply',
  money_or_legal: 'Money',
  deadline: 'Deadline',
  security: 'Security',
  fyi: 'FYI',
  promo: 'Promo',
};

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
  category: Category;
  urgencyScore: number;
};

export type ClassifyMessage = { type: 'classify', emails: EmailState[] };

export type ClassifyResult =
  | {
      ok: true;
      results: Record<string, Classification>;
      errorCount: number;
      errorMessage: string | null;
    }
  | { ok: false; error: 'missing_key' | 'failed' };

export function threadKey(state: EmailState): string {
  return `${state.threadId}|${state.lastMessageId}`;
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

const THREAD_ID = /^[A-Za-z0-9]{16,}$/;

export function viewFromHash(hash: string): View | null {
  const parts: string[] = [];
  for (const raw of hash.replace(/^#/, '').split('?')[0].split('/')) {
    if (raw.length === 0) continue;
    try {
      parts.push(decodeURIComponent(raw));
    } catch {
      parts.push(raw);
    }
  }
  if (parts.length === 0) return 'inbox';
  if (THREAD_ID.test(parts[parts.length - 1])) return null;
  const head = parts[0];
  if (head === 'inbox') return 'inbox';
  if (head === 'category') return 'tabs';
  if (head === 'search' || head === 'advanced-search') return 'search';
  return 'other';
}

export function threadHash(hash: string, legacyThreadId: string): string {
  const parts = hash.replace(/^#/, '').split('?')[0].split('/').filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  const list = last !== undefined && THREAD_ID.test(last) ? parts.slice(0, -1) : parts;
  return list.length > 0 ? `#${list.join('/')}/${legacyThreadId}` : `#inbox/${legacyThreadId}`;
}
