import { DEFAULT_SETTINGS, VIEWS, VIEW_SETTING_KEYS } from './shared';

const apiKey = document.getElementById('apiKey') as HTMLInputElement;
const enabled = document.getElementById('enabled') as HTMLInputElement;
const threshold = document.getElementById('threshold') as HTMLInputElement;
const thresholdValue = document.getElementById('thresholdValue') as HTMLSpanElement;
const clear = document.getElementById('clear') as HTMLButtonElement;
const saved = document.getElementById('saved') as HTMLSpanElement;

const viewInputs: Record<string, HTMLInputElement> = {
  viewInbox: document.getElementById('viewInbox') as HTMLInputElement,
  viewTabs: document.getElementById('viewTabs') as HTMLInputElement,
  viewSearch: document.getElementById('viewSearch') as HTMLInputElement,
  viewOther: document.getElementById('viewOther') as HTMLInputElement,
};

function showSaved(): void {
  saved.style.display = 'inline';
  setTimeout(() => {
    saved.style.display = 'none';
  }, 1500);
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([
    'apiKey',
    'enabled',
    'threshold',
    ...VIEWS.map((view) => VIEW_SETTING_KEYS[view]),
  ]);
  apiKey.value = typeof stored.apiKey === 'string' ? stored.apiKey : '';
  enabled.checked = stored.enabled !== false;
  const value = typeof stored.threshold === 'number' ? stored.threshold : DEFAULT_SETTINGS.threshold;
  threshold.value = String(value);
  thresholdValue.textContent = String(value);
  for (const view of VIEWS) {
    const key = VIEW_SETTING_KEYS[view];
    const storedValue = stored[key];
    viewInputs[key].checked =
      typeof storedValue === 'boolean' ? storedValue : DEFAULT_SETTINGS[key];
  }
}

apiKey.addEventListener('change', () => {
  void chrome.storage.local.set({ apiKey: apiKey.value }).then(showSaved);
});
enabled.addEventListener('change', () => {
  void chrome.storage.local.set({ enabled: enabled.checked }).then(showSaved);
});
threshold.addEventListener('input', () => {
  thresholdValue.textContent = String(Number(threshold.value));
});
threshold.addEventListener('change', () => {
  void chrome.storage.local.set({ threshold: Number(threshold.value) }).then(showSaved);
});
for (const view of VIEWS) {
  const key = VIEW_SETTING_KEYS[view];
  const input = viewInputs[key];
  input.addEventListener('change', () => {
    void chrome.storage.local.set({ [key]: input.checked }).then(showSaved);
  });
}
clear.addEventListener('click', () => {
  void (async () => {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter((key) => key.startsWith('crit:'));
    if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);
    showSaved();
  })();
});

void load();
