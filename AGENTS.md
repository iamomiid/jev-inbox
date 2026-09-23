# jev-inbox

Chrome MV3 extension, Jev Inbox for Gmail. It moves Gmail's own unread rows to the top of the visible message list on the inbox, other inbox tabs, search results, and labels and other folders, each switchable in the popup. Critical rows come first, every classified unread row carries the label chips whose probability clears the sensitivity threshold, and a thin status bar above the list shows the unread count, in-flight progress, and errors. Unread rows are classified by TypeSafe Jev with the `ai` SDK's `experimental_evaluate`, on Vercel AI Gateway (`createGateway`, `typesafe-ai/jev`) or on TypeSafe's own API (`createTypeSafeAi`, `jev-latest`), chosen in the popup. Classification waits for `privacyAck`, the first-run notice in the popup. Low-ceremony code by design.

This file is the entry point for agents. Every doc describes the current state of the repo, never its history. The rules in ~/.codex/AGENTS.md apply on top of this file.

## Read next

- `docs/README.md`
- `README.md` and `PRIVACY.md`, the two files a stranger reads first

## Working here

Stack: TypeScript, esbuild, Chrome MV3.

Commands:

- `npm run build`: bundles `src/`, `dev/demo.ts`, and `dev/store/stub.ts` to `dist/` (esbuild) and copies `manifest.json`, `popup.html`, `section.css`, and `assets/`.
- `npm run watch`: same build, rebuilds on change.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run store-images`: runs the build, then `scripts/store-images.mjs`, which renders the Chrome Web Store screenshots and promo tiles into `docs/store/` and regenerates `docs/images/popup-light.png` and `popup-dark.png`.

File map:

- `src/background.ts`: service worker. Handles `classify` and `test` messages, returns `needs_ack` for both until the popup stores `privacyAck`, resolves the provider and the matching key, caches classifications in `chrome.storage.local` under a key that includes the provider and the labels hash with a `ts` stamp, fans out to the chosen provider, reports per-row failures with the HTTP status, keeps a good classification when a cache write fails, and prunes the cache to 4000 entries once it passes 5000.
- `src/content.ts`: content script. Parses the current view from the hash, watches the visible list DOM and its rows' class changes, reorders the rows to the top of Gmail's own list with critical rows first synchronously in the observer callback, before the next paint, from the classifications it keeps in memory, extracts and dispatches the unread rows that still need classification, writes label chips and loading dots inside the rows, renders the status bar with its progress line, halts on `needs_ack`, auth failures, or a missing key until the popup fixes it, animates a row that becomes critical with a FLIP it tracks and restores, backs off failed rows through a map that outlives the rows, resets the recorded order when the route or the row set changes.
- `src/jev.ts`: `classifyEmail` and `testConnection`. Both build and run one Jev evaluation call on the chosen provider: critical, urgency, and one boolean question per label for a row, one boolean question on a fixed dummy state for the popup's connection check.
- `src/shared.ts`: shared types, `Provider`, settings defaults and key lists, label config, validators, `labelsHash`, `cacheVersion`, `threadKey`, `routeKey`, view and hash parsing.
- `src/popup.ts`: popup logic. Saves the provider, each provider's key plus a `...Hint` of its last four characters, enabled, sensitivity, the first-run acknowledgement, the Show on view toggles, and the label list; never reads a stored key back, showing "Key saved, ends in ..." with Replace and Remove instead; runs the connection test, disabled until the notice is accepted; clears the classification cache.
- `src/popup.html`: popup markup and its inline styles and theme tokens, including the labels editor.
- `src/section.css`: styles for the status bar, the Critical badge, and the inline label chips, all following Gmail's current theme.
- `assets/icon.svg`: icon source. `assets/icon-{16,32,48,128}.png` are rendered from it and copied into `dist/assets` by the build.
- `dev/demo.html` and `dev/demo.ts`: Gmail-like demo list with made-up mail, a stubbed `chrome` API, and canned classifications. Build first, then open the file. `?theme=dark` for the dark list, `?ack=0` for a browser that has not accepted the notice. `fixtures/` stays gitignored.
- `dev/store/`: sources for the Chrome Web Store screenshots and promo tiles. `store.css` holds the shared browser-chrome mockup, headline panel and popup-card styles. `frame.html` is the parameterized 1280x800 compose page for the five store screenshots, driven by a `scene` query param, with the Gmail-like list authored inline from the same made-up mail as `dev/demo.html`. `promo-small.html` and `promo-marquee.html` are the small and marquee promo tiles. `stub.ts` stubs `chrome.storage` and `chrome.runtime` with a state decoded from a `state` query param, the same technique as `dev/demo.ts`, so the real `dist/popup.html` and `popup.js` render each popup scenario. `scripts/store-images.mjs` injects `stub.js` into a copy of `dist/popup.html`, screenshots each scenario with headless Chrome, and composes the final images; run it with `npm run store-images`.

All work ends on `main` with a commit. No push, no PR, no release without Omid.
Thinking, strategy, and decisions live outside this repo.

## Build and load

1. `npm install`
2. `npm run build`: bundles to `dist/` (esbuild) and copies `manifest.json`, `popup.html`, `section.css`, `assets/`. `npm run watch` rebuilds on change.
3. Chrome: chrome://extensions, enable Developer mode, "Load unpacked", select the `dist/` folder.
4. Open the extension popup, accept the first-run notice, pick the provider under "Connection", paste its API key, leave the switch on, pick the views under "Show on", add labels if wanted. Gmail: mail.google.com moves the unread rows of the visible list to the top and shows the status bar on the enabled views.

`npx tsc --noEmit` typechecks. Calls go to `https://ai-gateway.vercel.sh/v4/ai` or `https://api.typesafe.ai/v1`; both keys live in `chrome.storage.local` and only the service worker reads them. The content script reads only the named settings and, through `getKeys`, the `crit:` cache entries.
