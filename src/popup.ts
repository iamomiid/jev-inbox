import {
  DEFAULT_SETTINGS,
  MAX_LABELS,
  SETTING_KEYS,
  VIEWS,
  VIEW_SETTING_KEYS,
  isLabelConfig,
  isProvider,
  type LabelConfig,
} from './shared';

const provider = document.getElementById('provider') as HTMLSelectElement;
const apiKey = document.getElementById('apiKey') as HTMLInputElement;
const typesafeApiKey = document.getElementById('typesafeApiKey') as HTMLInputElement;
const apiKeyRow = document.getElementById('apiKeyRow') as HTMLDivElement;
const typesafeApiKeyRow = document.getElementById('typesafeApiKeyRow') as HTMLDivElement;
const enabled = document.getElementById('enabled') as HTMLInputElement;
const threshold = document.getElementById('threshold') as HTMLInputElement;
const thresholdValue = document.getElementById('thresholdValue') as HTMLSpanElement;
const clear = document.getElementById('clear') as HTMLButtonElement;
const saved = document.getElementById('saved') as HTMLSpanElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const addLabel = document.getElementById('addLabel') as HTMLButtonElement;
const saveLabels = document.getElementById('saveLabels') as HTMLButtonElement;
const labelError = document.getElementById('labelError') as HTMLSpanElement;

const viewInputs: Record<string, HTMLInputElement> = {
  viewInbox: document.getElementById('viewInbox') as HTMLInputElement,
  viewTabs: document.getElementById('viewTabs') as HTMLInputElement,
  viewSearch: document.getElementById('viewSearch') as HTMLInputElement,
  viewOther: document.getElementById('viewOther') as HTMLInputElement,
};

let draft: LabelConfig[] = [];

function showSaved(): void {
  saved.style.display = 'inline';
  setTimeout(() => {
    saved.style.display = 'none';
  }, 1500);
}

function renderLabels(): void {
  labelsEl.textContent = '';
  addLabel.disabled = draft.length >= MAX_LABELS;
  for (let index = 0; index < draft.length; index++) {
    const item = draft[index];
    const row = document.createElement('div');
    row.className = 'label-row';

    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Name';
    name.value = item.name;
    name.addEventListener('input', () => {
      item.name = name.value;
    });

    const description = document.createElement('input');
    description.type = 'text';
    description.placeholder = 'What belongs under it';
    description.value = item.description;
    description.addEventListener('input', () => {
      item.description = description.value;
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      draft.splice(index, 1);
      renderLabels();
    });

    row.appendChild(name);
    row.appendChild(description);
    row.appendChild(remove);
    labelsEl.appendChild(row);
  }
}

function updateKeyRows(): void {
  apiKeyRow.style.display = provider.value === 'gateway' ? '' : 'none';
  typesafeApiKeyRow.style.display = provider.value === 'typesafe' ? '' : 'none';
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([...SETTING_KEYS]);
  provider.value = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;
  apiKey.value = typeof stored.apiKey === 'string' ? stored.apiKey : '';
  typesafeApiKey.value = typeof stored.typesafeApiKey === 'string' ? stored.typesafeApiKey : '';
  updateKeyRows();
  enabled.checked = stored.enabled !== false;
  const value = typeof stored.threshold === 'number' ? stored.threshold : DEFAULT_SETTINGS.threshold;
  threshold.value = String(value);
  thresholdValue.textContent = String(value);
  draft = Array.isArray(stored.labels) ? stored.labels.filter(isLabelConfig) : [];
  renderLabels();
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
provider.addEventListener('change', () => {
  void chrome.storage.local.set({ provider: provider.value }).then(showSaved);
  updateKeyRows();
});
typesafeApiKey.addEventListener('change', () => {
  void chrome.storage.local.set({ typesafeApiKey: typesafeApiKey.value }).then(showSaved);
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
addLabel.addEventListener('click', () => {
  if (draft.length >= MAX_LABELS) return;
  draft.push({ id: crypto.randomUUID(), name: '', description: '' });
  renderLabels();
});
saveLabels.addEventListener('click', () => {
  const savedLabels = draft.map(({ id, name, description }) => ({
    id,
    name: name.trim(),
    description: description.trim(),
  }));
  if (savedLabels.some((label) => label.name.length === 0 || label.description.length === 0)) {
    labelError.textContent = 'Each label needs a name and a description.';
    return;
  }
  labelError.textContent = '';
  void chrome.storage.local.set({ labels: savedLabels.slice(0, MAX_LABELS) }).then(showSaved);
});
clear.addEventListener('click', () => {
  void (async () => {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter((key) => key.startsWith('crit:'));
    if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);
    showSaved();
  })();
});

void load();
