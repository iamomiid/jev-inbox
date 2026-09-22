import { classifyEmail } from './jev';
import {
  cacheVersion,
  isClassification,
  isEmailState,
  isLabelConfig,
  isProvider,
  threadKey,
  type ClassifyError,
  type ClassifyMessage,
  type ClassifyResult,
  type Classification,
  type EmailState,
  type LabelConfig,
  type Provider,
} from './shared';

const CACHE_PREFIX = 'crit:';
const CONCURRENCY = 8;
const CACHE_MAX = 5000;
const CACHE_KEEP = 4000;

const inflight = new Map<string, Promise<Classification>>();

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

  const { provider: storedProvider, apiKey, typesafeApiKey } = await chrome.storage.local.get([
    'provider',
    'apiKey',
    'typesafeApiKey',
  ]);
  const provider = isProvider(storedProvider) ? storedProvider : 'gateway';
  const key = provider === 'typesafe' ? typesafeApiKey : apiKey;
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, error: 'missing_key' } satisfies ClassifyResult;
  }

  const version = cacheVersion(labels, provider);
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
  let authAborted = false;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      if (authAborted) return;
      const task = queue.shift();
      if (task === undefined) return;
      try {
        results[task.key] = await classifyWithCache(task.storeKey, task.email, key, labels, provider);
      } catch (error) {
        const failure = toClassifyError(error);
        errors[task.key] = failure;
        if (failure.status === 401 || failure.status === 403) {
          authAborted = true;
          return;
        }
      }
    }
  });
  await Promise.all(workers);
  if (fresh.length > 0) await pruneCache();
  return { ok: true, results, errors };
}

function classifyWithCache(
  storeKey: string,
  email: EmailState,
  apiKey: string,
  labels: LabelConfig[],
  provider: Provider
): Promise<Classification> {
  const existing = inflight.get(storeKey);
  if (existing !== undefined) return existing;
  const promise = resolveClassification(storeKey, email, apiKey, labels, provider).finally(() => {
    inflight.delete(storeKey);
  });
  inflight.set(storeKey, promise);
  return promise;
}

async function resolveClassification(
  storeKey: string,
  email: EmailState,
  apiKey: string,
  labels: LabelConfig[],
  provider: Provider
): Promise<Classification> {
  const stored = await chrome.storage.local.get(storeKey);
  const hit = stored[storeKey];
  if (isClassification(hit)) return hit;
  const classification = await classifyEmail(email, apiKey, labels, provider);
  try {
    await chrome.storage.local.set({ [storeKey]: { ...classification, ts: Date.now() } });
  } catch (error) {
    console.error('cache write failed', error);
  }
  return classification;
}

async function pruneCache(): Promise<void> {
  if (typeof chrome.storage.local.getKeys !== 'function') return;
  try {
    const keys = (await chrome.storage.local.getKeys()).filter((key) =>
      key.startsWith(CACHE_PREFIX)
    );
    if (keys.length <= CACHE_MAX) return;
    const stored = await chrome.storage.local.get(keys);
    const ranked = keys
      .map((key) => {
        const entry: unknown = stored[key];
        const ts =
          typeof entry === 'object' &&
          entry !== null &&
          'ts' in entry &&
          typeof entry.ts === 'number'
            ? entry.ts
            : 0;
        return { key, ts };
      })
      .sort((a, b) => a.ts - b.ts);
    const excess = keys.length - CACHE_KEEP;
    await chrome.storage.local.remove(ranked.slice(0, excess).map((item) => item.key));
  } catch (error) {
    console.error('cache prune failed', error);
  }
}

function toClassifyError(error: unknown): ClassifyError {
  const raw = error instanceof Error ? error.message : String(error);
  const failure: ClassifyError = {
    message: (raw || 'Classification failed').slice(0, 160),
  };
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = error.statusCode;
    if (typeof code === 'number') failure.status = code;
  }
  return failure;
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
