export type Settings = {
  apiKey: string;
  enabled: boolean;
  threshold: number;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  enabled: true,
  threshold: 0.7,
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
