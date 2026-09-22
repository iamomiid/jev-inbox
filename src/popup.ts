import {
  DEFAULT_SETTINGS,
  MAX_LABELS,
  POPUP_SETTING_KEYS,
  VIEWS,
  VIEW_SETTING_KEYS,
  isLabelConfig,
  isProvider,
  type LabelConfig,
  type Provider,
  type TestResult,
} from './shared';

const CACHE_PREFIX = 'crit:';
const CHIP_HUES = 8;
const CONFIRM_MS = 2500;

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>';

const providerInputs: Record<Provider, HTMLInputElement> = {
  gateway: document.getElementById('providerGateway') as HTMLInputElement,
  typesafe: document.getElementById('providerTypesafe') as HTMLInputElement,
};

type KeyField = {
  keyName: 'apiKey' | 'typesafeApiKey';
  hintName: 'apiKeyHint' | 'typesafeApiKeyHint';
  input: HTMLInputElement;
  eye: HTMLButtonElement;
  saved: HTMLDivElement;
  savedText: HTMLSpanElement;
  edit: HTMLDivElement;
  cancel: HTMLButtonElement;
  replace: HTMLButtonElement;
  remove: HTMLButtonElement;
};

const keyFields: Record<Provider, KeyField> = {
  gateway: {
    keyName: 'apiKey',
    hintName: 'apiKeyHint',
    input: document.getElementById('apiKey') as HTMLInputElement,
    eye: document.getElementById('apiKeyEye') as HTMLButtonElement,
    saved: document.getElementById('apiKeySaved') as HTMLDivElement,
    savedText: document.getElementById('apiKeySavedText') as HTMLSpanElement,
    edit: document.getElementById('apiKeyEdit') as HTMLDivElement,
    cancel: document.getElementById('apiKeyCancel') as HTMLButtonElement,
    replace: document.getElementById('apiKeyReplace') as HTMLButtonElement,
    remove: document.getElementById('apiKeyRemove') as HTMLButtonElement,
  },
  typesafe: {
    keyName: 'typesafeApiKey',
    hintName: 'typesafeApiKeyHint',
    input: document.getElementById('typesafeApiKey') as HTMLInputElement,
    eye: document.getElementById('typesafeApiKeyEye') as HTMLButtonElement,
    saved: document.getElementById('typesafeApiKeySaved') as HTMLDivElement,
    savedText: document.getElementById('typesafeApiKeySavedText') as HTMLSpanElement,
    edit: document.getElementById('typesafeApiKeyEdit') as HTMLDivElement,
    cancel: document.getElementById('typesafeApiKeyCancel') as HTMLButtonElement,
    replace: document.getElementById('typesafeApiKeyReplace') as HTMLButtonElement,
    remove: document.getElementById('typesafeApiKeyRemove') as HTMLButtonElement,
  },
};

const apiKeyRow = document.getElementById('apiKeyRow') as HTMLDivElement;
const typesafeApiKeyRow = document.getElementById('typesafeApiKeyRow') as HTMLDivElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const testHint = document.getElementById('testHint') as HTMLSpanElement;
const testResult = document.getElementById('testResult') as HTMLSpanElement;
const enabled = document.getElementById('enabled') as HTMLInputElement;
const statusLine = document.getElementById('statusLine') as HTMLParagraphElement;
const saved = document.getElementById('saved') as HTMLSpanElement;
const privacyNotice = document.getElementById('privacyNotice') as HTMLDivElement;
const gotIt = document.getElementById('gotIt') as HTMLButtonElement;
const threshold = document.getElementById('threshold') as HTMLInputElement;
const thresholdValue = document.getElementById('thresholdValue') as HTMLSpanElement;
const clear = document.getElementById('clear') as HTMLButtonElement;
const version = document.getElementById('version') as HTMLSpanElement;
const labelsEl = document.getElementById('labels') as HTMLDivElement;
const labelsEmpty = document.getElementById('labelsEmpty') as HTMLParagraphElement;
const labelCount = document.getElementById('labelCount') as HTMLSpanElement;
const addLabel = document.getElementById('addLabel') as HTMLButtonElement;
const labelError = document.getElementById('labelError') as HTMLSpanElement;

const viewInputs: Record<string, HTMLInputElement> = {
  viewInbox: document.getElementById('viewInbox') as HTMLInputElement,
  viewTabs: document.getElementById('viewTabs') as HTMLInputElement,
  viewSearch: document.getElementById('viewSearch') as HTMLInputElement,
  viewOther: document.getElementById('viewOther') as HTMLInputElement,
};

const keyHints: Record<KeyField['keyName'], string> = { apiKey: '', typesafeApiKey: '' };

let draft: LabelConfig[] = [];
let acknowledged = false;
let savedTimer: number | undefined;
const confirmTimers = new WeakMap<HTMLButtonElement, number>();

function showSaved(text = 'Saved'): void {
  saved.textContent = text;
  saved.classList.add('show');
  if (savedTimer !== undefined) window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.remove('show'), 1500);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function updateKeyRows(): void {
  const isTypesafe = providerInputs.typesafe.checked;
  apiKeyRow.hidden = isTypesafe;
  typesafeApiKeyRow.hidden = !isTypesafe;
}

function updateStatus(): void {
  const hint = keyHints[providerInputs.typesafe.checked ? 'typesafeApiKey' : 'apiKey'];
  if (!enabled.checked) {
    statusLine.textContent = 'Paused';
  } else if (hint.length === 0) {
    statusLine.textContent = 'Add a key to start';
  } else {
    statusLine.textContent = 'Active on this Gmail tab';
  }
}

function updateTestRow(): void {
  testBtn.disabled = !acknowledged;
  testHint.hidden = acknowledged;
}

function showSavedKey(field: KeyField, hint: string): void {
  keyHints[field.keyName] = hint;
  field.saved.hidden = hint.length === 0;
  field.savedText.textContent = hint.length === 0 ? '' : `Key saved, ends in ...${hint}`;
  field.edit.hidden = hint.length > 0;
  field.cancel.hidden = true;
  field.input.value = '';
}

function revealKeyInput(field: KeyField): void {
  field.saved.hidden = true;
  field.edit.hidden = false;
  field.cancel.hidden = keyHints[field.keyName].length === 0;
  field.input.value = '';
  field.input.focus();
}

function saveKey(field: KeyField): void {
  const value = field.input.value.trim();
  if (value.length === 0) return;
  const hint = value.slice(-4);
  void chrome.storage.local
    .set({ [field.keyName]: value, [field.hintName]: hint })
    .then(() => {
      showSavedKey(field, hint);
      updateStatus();
      showSaved();
    });
}

function removeKey(field: KeyField): void {
  void chrome.storage.local.remove([field.keyName, field.hintName]).then(() => {
    showSavedKey(field, '');
    updateStatus();
    showSaved('Removed');
  });
}

function armConfirm(
  button: HTMLButtonElement,
  action: () => void,
  confirmLabel: string,
  confirmText?: string
): void {
  const originalLabel = button.getAttribute('aria-label');
  const originalText = button.textContent;
  const restore = (): void => {
    const timer = confirmTimers.get(button);
    if (timer !== undefined) window.clearTimeout(timer);
    confirmTimers.delete(button);
    button.classList.remove('confirm');
    if (originalLabel !== null) button.setAttribute('aria-label', originalLabel);
    if (confirmText !== undefined) button.textContent = originalText;
  };
  button.addEventListener('click', () => {
    if (button.classList.contains('confirm')) {
      restore();
      action();
      return;
    }
    button.classList.add('confirm');
    button.setAttribute('aria-label', confirmLabel);
    if (confirmText !== undefined) button.textContent = confirmText;
    confirmTimers.set(button, window.setTimeout(restore, CONFIRM_MS));
  });
}

function saveLabels(): void {
  const next = draft.map(({ id, name, description }) => ({
    id,
    name: name.trim(),
    description: description.trim(),
  }));
  if (next.some((label) => label.name.length === 0 || label.description.length === 0)) {
    labelError.textContent = 'Each label needs a name and a description.';
    return;
  }
  labelError.textContent = '';
  void chrome.storage.local.set({ labels: next.slice(0, MAX_LABELS) }).then(() => showSaved());
}

function renderLabels(): void {
  labelsEl.textContent = '';
  addLabel.disabled = draft.length >= MAX_LABELS;
  labelCount.textContent = `${draft.length} / ${MAX_LABELS}`;
  labelsEmpty.hidden = draft.length > 0;
  for (let index = 0; index < draft.length; index++) {
    const item = draft[index];
    const card = document.createElement('div');
    card.className = 'label-card';

    const dot = document.createElement('span');
    dot.className = `dot hue-${index % CHIP_HUES}`;

    const fields = document.createElement('div');
    fields.className = 'fields';

    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Name';
    name.value = item.name;
    name.setAttribute('aria-label', `Label ${index + 1} name`);
    name.addEventListener('input', () => {
      item.name = name.value;
    });
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') name.blur();
    });
    name.addEventListener('blur', saveLabels);

    const description = document.createElement('textarea');
    description.rows = 2;
    description.placeholder = 'What belongs under it';
    description.value = item.description;
    description.setAttribute('aria-label', `Label ${index + 1} description`);
    const grow = (): void => {
      description.style.height = 'auto';
      description.style.height = `${description.scrollHeight}px`;
    };
    description.addEventListener('input', () => {
      item.description = description.value;
      grow();
    });
    description.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        description.blur();
      }
    });
    description.addEventListener('blur', saveLabels);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'trash';
    remove.setAttribute('aria-label', 'Delete label');
    remove.innerHTML = TRASH_SVG;
    armConfirm(
      remove,
      () => {
        draft.splice(index, 1);
        renderLabels();
        saveLabels();
      },
      'Confirm delete'
    );

    fields.appendChild(name);
    fields.appendChild(description);
    card.appendChild(dot);
    card.appendChild(fields);
    card.appendChild(remove);
    labelsEl.appendChild(card);
    grow();
  }
}

function wireEye(button: HTMLButtonElement, input: HTMLInputElement): void {
  button.addEventListener('click', () => {
    const revealed = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', revealed ? 'false' : 'true');
    button.setAttribute('aria-label', revealed ? 'Show key' : 'Hide key');
    input.type = revealed ? 'password' : 'text';
  });
}

async function runTestConnection(): Promise<void> {
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  testResult.className = 'test-result';
  testResult.textContent = '';
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'test' })) as TestResult;
    if (response.ok) {
      testResult.className = 'test-result ok';
      testResult.textContent = 'Connected';
    } else {
      testResult.className = 'test-result error';
      testResult.textContent = response.message;
    }
  } catch {
    testResult.className = 'test-result error';
    testResult.textContent = 'Connection test failed.';
  } finally {
    testBtn.textContent = 'Test connection';
    updateTestRow();
  }
}

function clearCache(): void {
  void (async () => {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);
    showSaved('Cleared');
  })();
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([...POPUP_SETTING_KEYS]);
  const storedProvider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;
  providerInputs[storedProvider].checked = true;
  showSavedKey(keyFields.gateway, typeof stored.apiKeyHint === 'string' ? stored.apiKeyHint : '');
  showSavedKey(
    keyFields.typesafe,
    typeof stored.typesafeApiKeyHint === 'string' ? stored.typesafeApiKeyHint : ''
  );
  updateKeyRows();
  enabled.checked = stored.enabled !== false;
  const value = typeof stored.threshold === 'number' ? stored.threshold : DEFAULT_SETTINGS.threshold;
  threshold.value = String(value);
  thresholdValue.textContent = percent(value);
  acknowledged = stored.privacyAck === true;
  privacyNotice.hidden = acknowledged;
  updateTestRow();
  draft = Array.isArray(stored.labels) ? stored.labels.filter(isLabelConfig) : [];
  renderLabels();
  for (const view of VIEWS) {
    const key = VIEW_SETTING_KEYS[view];
    const storedValue = stored[key];
    viewInputs[key].checked = typeof storedValue === 'boolean' ? storedValue : DEFAULT_SETTINGS[key];
  }
  version.textContent = `v${chrome.runtime.getManifest().version}`;
  updateStatus();
}

for (const provider of ['gateway', 'typesafe'] as const) {
  providerInputs[provider].addEventListener('change', () => {
    if (!providerInputs[provider].checked) return;
    updateKeyRows();
    updateStatus();
    void chrome.storage.local.set({ provider }).then(() => showSaved());
  });
}

for (const field of [keyFields.gateway, keyFields.typesafe]) {
  wireEye(field.eye, field.input);
  field.input.addEventListener('change', () => {
    saveKey(field);
  });
  field.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    field.input.blur();
  });
  field.replace.addEventListener('click', () => {
    revealKeyInput(field);
  });
  field.cancel.addEventListener('click', () => {
    showSavedKey(field, keyHints[field.keyName]);
  });
  armConfirm(field.remove, () => removeKey(field), 'Confirm remove key', 'Confirm');
}

enabled.addEventListener('change', () => {
  updateStatus();
  void chrome.storage.local.set({ enabled: enabled.checked }).then(() => showSaved());
});

threshold.addEventListener('input', () => {
  thresholdValue.textContent = percent(Number(threshold.value));
});
threshold.addEventListener('change', () => {
  void chrome.storage.local.set({ threshold: Number(threshold.value) }).then(() => showSaved());
});

for (const view of VIEWS) {
  const key = VIEW_SETTING_KEYS[view];
  const input = viewInputs[key];
  input.addEventListener('change', () => {
    void chrome.storage.local.set({ [key]: input.checked }).then(() => showSaved());
  });
}

addLabel.addEventListener('click', () => {
  if (draft.length >= MAX_LABELS) return;
  draft.push({ id: crypto.randomUUID(), name: '', description: '' });
  renderLabels();
});

testBtn.addEventListener('click', () => {
  void runTestConnection();
});

gotIt.addEventListener('click', () => {
  acknowledged = true;
  privacyNotice.hidden = true;
  updateTestRow();
  void chrome.storage.local.set({ privacyAck: true }).then(() => showSaved());
});

armConfirm(clear, clearCache, 'Confirm clear cache');

void load();
