# Docs

Current-state docs for jev-inbox.

- `gmail-dom.md`: the Gmail selectors the content script relies on, and what to check first when Gmail changes its markup.
- `store-listing.md`: draft Chrome Web Store text, permission justifications, data use disclosure answers, and the Images section listing each store asset.
- `images/`: screenshots the README links to, light and dark, list and popup.
- `store/`: Chrome Web Store screenshots and promo tiles, built from `dev/store/` by `npm run store-images`.

`dev/store/` holds the HTML sources for the Chrome Web Store images (browser-chrome mockups, the reordered list, and the popup states) and the `stub.ts` storage stub that drives the real popup markup for those captures.
