# gmail-critical (scratch)

Chrome extension: Critical section on Gmail inbox, classified by TypeSafe Jev via Vercel AI Gateway Built 2026-09-22. Disposable: no tests, no docs
beyond this file, no publishing. The rules in ~/.codex/AGENTS.md still
apply.

## Build and load

1. `npm install`
2. `npm run build`: bundles `src/` to `dist/` (esbuild) and copies `manifest.json`, `popup.html`, `section.css`. `npm run watch` rebuilds on change.
3. Chrome: chrome://extensions, enable Developer mode, "Load unpacked", select the `dist/` folder.
4. Open the extension popup, paste the TypeSafe Jev key (Vercel AI Gateway), leave "Enabled" on. Gmail: mail.google.com with an open inbox tab shows the Critical section above the list.

`npx tsc --noEmit` typechecks. Calls go to `https://ai-gateway.vercel.sh/v4/ai`; the key lives in `chrome.storage.local`; the content script never sees it.
