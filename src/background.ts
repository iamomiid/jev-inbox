import { classifyEmail } from './gateway';
import {
  isEmailState,
  isLabelConfig,
  labelsHash,
  threadKey,
  type ClassifyError,
  type ClassifyMessage,
  type ClassifyResult,
  type Classification,
  type EmailState,
} from './shared';

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
  const request = classifyRequest(message);
  if (request === undefined) return { ok: false, error: 'failed' } satisfies ClassifyResult;
  const { emails, labels } = request;

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return { ok: false, error: 'missing_key' } satisfies ClassifyResult;
  }

  const version = labelsHash(labels);
  const tasks = new Map<string, { email: EmailState; key: string; storeKey: string }>();
  for (const email of emails) {
    const key = threadKey(email, version);
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
  const errors: Record<string, ClassifyError> = {};
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task === undefined) return;
      try {
        const classification = await classifyEmail(task.email, apiKey, labels);
        results[task.key] = classification;
        await chrome.storage.local.set({ [task.storeKey]: classification });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const failure: ClassifyError = {
          message: (raw || 'Classification failed').slice(0, 160),
        };
        if (typeof error === 'object' && error !== null && 'statusCode' in error) {
          const code = error.statusCode;
          if (typeof code === 'number') failure.status = code;
        }
        errors[task.key] = failure;
      }
    }
  });
  await Promise.all(workers);
  return { ok: true, results, errors };
}

function classifyRequest(value: unknown): ClassifyMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('type' in value) || value.type !== 'classify') return undefined;
  if (!('emails' in value) || !Array.isArray(value.emails)) return undefined;
  if (!('labels' in value) || !Array.isArray(value.labels)) return undefined;
  const emails = value.emails.filter(isEmailState);
  const labels = value.labels.filter(isLabelConfig);
  if (emails.length !== value.emails.length) return undefined;
  if (labels.length !== value.labels.length) return undefined;
  return { type: 'classify', emails, labels };
}

function isClassification(value: unknown): value is Classification {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.criticalProbability !== 'number') return false;
  if (typeof v.urgencyScore !== 'number') return false;
  const labels = v.labels;
  if (typeof labels !== 'object' || labels === null) return false;
  return Object.values(labels).every((probability) => typeof probability === 'number');
}
