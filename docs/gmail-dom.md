# Gmail DOM

The content script reads the message list out of Gmail's rendered markup. It only acts on unread rows, and only in the list views the popup enables. Everything below is brittle by nature: Gmail ships obfuscated class names and changes them without notice.

## Views

`currentView()` classifies `location.hash` once a visible `div[role=main]` with a `tr.zA` row exists. Without one, the view is null and the section stays off.

- inbox: empty hash, `#inbox`, `#inbox?...`, including `#inbox?compose=...`.
- tabs: `#category/<name>`, so promotions, social, updates, forums.
- search: `#search/<query>`, `#advanced-search/...`.
- other: every other hash that lists mail: `#label/<name>`, `#starred`, `#imp`, `#all`, `#sent`, `#drafts`, and the rest.
- null: a hash whose thread id segment is a list segment plus a thread id. A thread id is the last segment when it is 16 or more `[A-Za-z0-9]` characters and it sits after the list part: one list segment for `inbox`, `starred`, `all`, `sent`, `drafts` and the rest, so `#inbox/FMfcg...` and `#starred/FMfcg...`; two list segments for `search`, `advanced-search`, `label`, `category`, so `#search/is%3Aunread/FMfcg...`, `#label/Work/FMfcg...`, `#category/social/FMfcg...`. A search or label query in list position that happens to be 16 or more alphanumerics, such as `#search/abcdefghijklmno123`, stays a list view.

`?` and everything after it is stripped before the hash is split on `/`, and each segment is decoded with `decodeURIComponent`.

Each view has a setting, in the popup under "Show on": `viewInbox` (on), `viewTabs` (on), `viewSearch` (on), `viewOther` (off). Settings live in `chrome.storage.local` and changes arrive on `chrome.storage.onChanged`. A view that is off loses its section and sends no classify requests.

## Selectors

- Visible main: `div[role=main]` with a computed display other than `none`, a set `offsetParent`, and a `tr.zA` row inside. The first match wins.
- Visible list: the first `.Cp` in main that holds a `tr.zA` and has a set `offsetParent` or a non-empty `getClientRects()`. Gmail keeps several `.Cp` elements in the page (hidden tabs, previous views), so the first `.Cp` is usually not the live one. Only rows inside this list become candidates.
- Section placement: the section root `div#gc-unread` is inserted as a child of the visible list's parent, immediately before the visible list. Switching views moves that same node, so only one section ever exists.
- Rows: `tr.zA.zE` inside the visible list. `zA` is the row class, `zE` marks unread. Read rows are `tr.zA` without `zE` (seen as `zA yO`), and are ignored.
- Sender: `span.zF[email][name]`. `name` is the display name, `email` the address.
- Subject and ids: `span.bqe[data-thread-id]`. Text content is the subject. Attributes used:
  - `data-thread-id`: with the last message id and the labels hash, forms the classification cache key.
  - `data-legacy-thread-id`: the click target for opening the thread.
  - `data-legacy-last-message-id`: the rest of the cache key.
- Snippet: `span.y2`, with nested `span.Zt` removed before reading text. `Zt` holds Gmail's leading separator.
- Date: the `title` of `td.xW span[title]`, falling back to the text of `td.xW`.
- A row missing the sender, the subject element, or any of the three ids is skipped.
- Clicking an item sets `location.hash` to the current list hash plus the legacy thread id, with any query suffix stripped: `#search/is%3Aunread` becomes `#search/is%3Aunread/1a0ca24636cc08cc`. Gmail's back arrow then returns to the same view.

## Unread section

- The header reads `Unread` with the count of unread rows in the visible list. Every row renders as soon as it is found, before classification, with a small `classifying` marker (or `retrying` after a failed attempt); items re-sort as classifications arrive.
- Order: critical rows first, where critical means `criticalProbability` at or above the threshold setting, sorted by urgency score descending then critical probability descending. Then every other row, unclassified and failed rows included, in Gmail's own order.
- Each item shows the sender name, the subject, the snippet, and the date, plus a `Critical` badge on critical rows and one chip per label whose probability is at or above the threshold. Chip color comes from a fixed eight-color palette indexed by the label's position in the settings list.
- The labels themselves live in `chrome.storage.local` as `labels: { id, name, description }[]`, edited in the popup, capped at 15. Changes apply live.
- `render()` writes nothing when the ordered keys, classification state, threshold, label version, in-flight state, and error text are unchanged, and the mutation observer ignores records inside the section or carrying the section node, so rendering cannot drive itself.

## Classify flow

- The content script sends `{ type: 'classify', emails, labels }` to the service worker and receives `{ ok: true, results, errors }` or `{ ok: false, error }`. Results are keyed by thread id plus last message id plus the labels hash.
- Cache: `crit:` prefixed entries in `chrome.storage.local`. Editing labels changes the hash, so the visible rows reclassify; old entries stay until "Clear cache" removes them.
- A failed row backs off: 60 s after the first failure, doubling per consecutive failure up to 10 min. A 401 or 403, or a missing key, stops all requests until the `apiKey` setting changes.

## When Gmail changes

Check in this order:

1. Rows still match `tr.zA.zE`. If unread rows lose `zE` (or `zA`), the section goes empty and stops updating.
2. `span.zF` still carries `email` and `name`, and `span.bqe` still carries all three `data-` ids. Missing ids mean every row is skipped.
3. `span.y2` is still the snippet and `span.Zt` is still the separator to strip.
4. The visible `.Cp` is still the list container, so the section still lands above the rows. If Gmail wraps or renames it, the section goes missing on every view.
5. `div[role=main]` is still the visible list container.
6. Hash routes still look like `#inbox`, `#category/<name>`, `#search/<query>`, `#label/<name>`. A renamed route lands that view in "Labels and other folders" or switches the section off.
