import { classifyEmail } from './gateway';
import { isEmailState, threadKey, type ClassifyResult, type Classification, type EmailState } from './shared';

const CACHE_PREFIX = 'crit:';
const CONCURRENCY = 8;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handle(message).then(sendResponse, (err: unknown) => {
    console.error('classify failed', err);
    sendResponse({ ok: false, error: 'failed' } satisfies ClassifyResult);
  });
  return true;
});

async function handle(message: unknown): Promise<ClassifyResult> {
  const valid =
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'classify' &&
    Array.isArray((message as { emails?: unknown }).emails) &&
    ((message as { emails: unknown[] }).emails).every(isEmailState);
  if (!valid) return { ok: false, error: 'failed' } satisfies ClassifyResult;
  const emails = (message as { emails: EmailState[] }).emails;

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return { ok: false, error: 'missing_key' } satisfies ClassifyResult;
  }

  const tasks = new Map<string, { email: EmailState, key: string, storeKey: string }>();
  for (const email of emails) {
    const key = threadKey(email);
    tasks.set(key, { email, key, storeKey: `${CACHE_PREFIX}${key}` });
  }
  const stored = await chrome.storage.local.get([...tasks.values()].map((t) => t.storeKey));
  const results: Record<string, Classification> = {};
  for (const task of tasks.values()) {
    const hit = stored[task.storeKey];
    if (isClassification(hit)) results[task.key] = hit;
  }
  const fresh = [...tasks.values()].filter((task) => results[task.key] === undefined);

  const queue = [...fresh];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task === undefined) return;
      const classification = await classifyEmail(task.email, apiKey);
      results[task.key] = classification;
      await chrome.storage.local.set({ [task.storeKey]: classification });
    }
  });
  await Promise.all(workers);
  return { ok: true, results };
}

function isClassification(value: unknown): value is Classification {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.criticalProbability === 'number' &&
    typeof v.category === 'string' &&
    typeof v.urgencyScore === 'number'
  );
}
