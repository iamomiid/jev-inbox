# gmail-critical

Personal Chrome MV3 extension for Omid's own Gmail that moves Gmail's own unread rows to the top of the visible message list on the inbox, other inbox tabs, search results, and labels and other folders, each switchable in the popup. Critical rows come first, every classified unread row carries the label chips whose probability clears the threshold, and a thin status bar above the list shows the unread count, in-flight progress, and errors. Unread rows are classified by TypeSafe Jev (`typesafe-ai/jev`) through Vercel AI Gateway with the `ai` SDK's `experimental_evaluate`. Low-ceremony code by design.

This file is the entry point for agents. Every doc describes the current state of the repo, never its history. The rules in ~/.codex/AGENTS.md apply on top of this file.

## Read next

- `docs/README.md`

## Working here

Stack: TypeScript, esbuild, Chrome MV3.

Commands:

- `npm run build`: bundles `src/` to `dist/` (esbuild) and copies `manifest.json`, `popup.html`, `section.css`.
- `npm run watch`: same build, rebuilds on change.
- `npm run typecheck`: `tsc --noEmit`.

File map (`src/`):

- `background.ts`: service worker. Handles `classify` messages, reads the key, caches classifications in `chrome.storage.local` under a key that includes the labels hash, fans out to the gateway, and reports per-row failures with the HTTP status.
- `content.ts`: content script. Parses the current view from the hash, watches the visible list DOM, reorders the rows to the top of Gmail's own list with critical rows first synchronously in the observer callback, before the next paint, from the classifications it keeps in memory, extracts and dispatches the unread rows that still need classification, writes label chips and loading dots inside the rows, renders the status bar with its progress line, animates a row that becomes critical, backs off failed rows, and halts on auth failures until the key changes.
- `gateway.ts`: `classifyEmail`. Builds and runs one Jev evaluation call: critical, urgency, and one boolean question per label.
- `shared.ts`: shared types, settings defaults, label config, validators, `labelsHash`, `threadKey`, view and hash parsing.
- `popup.ts`: popup logic. Saves key, enabled, threshold, the Show on view toggles, and the label list, clears the classification cache.
- `popup.html`: popup markup and styles, including the labels editor.
- `section.css`: styles for the status bar, the Critical badge, and the inline label chips, all following Gmail's current theme.

All work ends on `main` with a commit. No push, no PR, no release without Omid.
Thinking, strategy, and decisions live outside this repo.

## Build and load

1. `npm install`
2. `npm run build`: bundles `src/` to `dist/` (esbuild) and copies `manifest.json`, `popup.html`, `section.css`. `npm run watch` rebuilds on change.
3. Chrome: chrome://extensions, enable Developer mode, "Load unpacked", select the `dist/` folder.
4. Open the extension popup, paste the TypeSafe Jev key (Vercel AI Gateway), leave "Enabled" on, pick the views under "Show on", add labels if wanted. Gmail: mail.google.com moves the unread rows of the visible list to the top and shows the status bar on the enabled views.

`npx tsc --noEmit` typechecks. Calls go to `https://ai-gateway.vercel.sh/v4/ai`; the key lives in `chrome.storage.local` and only the service worker uses it. The content script reads storage in bulk at bootstrap and keeps only the settings and the `crit:` cache entries.
