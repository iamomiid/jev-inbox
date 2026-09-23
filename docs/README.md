# Docs

Current-state docs for jev-inbox.

- `gmail-dom.md`: the Gmail selectors the content script relies on, and what to check first when Gmail changes its markup.
- `store-listing.md`: draft Chrome Web Store text, permission justifications, data use disclosure answers, and the Images section listing each store asset.
- `store/`: Chrome Web Store screenshots and promo tiles, built from `dev/store/` by `npm run store-images`.

`dev/store/` holds the HTML sources for the Chrome Web Store images: `scene.html` renders the five Gmail-window screenshots, `promo.html` renders the two promo tiles, and `stub.ts` is the storage stub that drives the real popup markup for those captures. Intermediates land in `dev/store/raw/`, which stays gitignored.
