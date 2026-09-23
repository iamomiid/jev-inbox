import { DEFAULT_SETTINGS, type Settings } from '../../src/shared';

type Store = Record<string, unknown>;
type Overrides = Partial<Settings> & { labels?: unknown; crop?: string };

const params = new URLSearchParams(location.search);
const encoded = params.get('state');
const overrides: Overrides = encoded ? JSON.parse(atob(encoded)) : {};
const { crop, ...settingsOverrides } = overrides;

const store: Store = { ...DEFAULT_SETTINGS, labels: [], ...settingsOverrides };

const style = document.createElement('style');
style.textContent = 'body{max-height:none!important;overflow:visible!important;}';
document.head.appendChild(style);

const CROP_SECTIONS: Record<string, string[]> = {
  labels: ['Connection', 'Labels'],
  key: ['Connection', 'Show on', 'Sensitivity'],
  privacy: [],
};

if (crop !== undefined) {
  const keep = new Set(CROP_SECTIONS[crop] ?? []);
  for (const section of Array.from(document.querySelectorAll<HTMLElement>('.section'))) {
    const heading = section.querySelector('h2')?.textContent ?? '';
    if (!keep.has(heading)) section.style.display = 'none';
  }
  document.querySelector<HTMLElement>('.footer')?.style.setProperty('display', 'none');
}

const listeners: unknown[] = [];

Object.assign(window, {
  chrome: {
    storage: {
      local: {
        get: async (keys?: string[] | null) => {
          if (keys === null || keys === undefined) return { ...store };
          const out: Store = {};
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (items: Store) => {
          Object.assign(store, items);
        },
        remove: async (keys: string[]) => {
          for (const key of keys) delete store[key];
        },
        getKeys: async () => Object.keys(store),
      },
      onChanged: {
        addListener: (listener: unknown) => {
          listeners.push(listener);
        },
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      getManifest: () => ({ version: '0.1.0' }),
    },
  },
});
