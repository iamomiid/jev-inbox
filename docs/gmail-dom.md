# Gmail DOM

The content script reads the message list out of Gmail's rendered markup. It reorders Gmail's own rows and writes chips into them, but only in the list views the popup enables. Everything below is brittle by nature: Gmail ships obfuscated class names and changes them without notice.

## Views

`currentView()` classifies `location.hash` once a visible `div[role=main]` with a `tr.zA` row exists. Without one, the view is null and nothing is injected.

- inbox: empty hash, `#inbox`, `#inbox?...`, including `#inbox?compose=...`.
- tabs: `#category/<name>`, so promotions, social, updates, forums.
- search: `#search/<query>`, `#advanced-search/...`.
- other: every other hash that lists mail: `#label/<name>`, `#starred`, `#imp`, `#all`, `#sent`, `#drafts`, and the rest.
- null: a hash whose thread id segment is a list segment plus a thread id. A thread id is the last segment when it is 16 or more `[A-Za-z0-9]` characters and it sits after the list part: one list segment for `inbox`, `starred`, `all`, `sent`, `drafts` and the rest, so `#inbox/FMfcg...` and `#starred/FMfcg...`; two list segments for `search`, `advanced-search`, `label`, `category`, so `#search/is%3Aunread/FMfcg...`, `#label/Work/FMfcg...`, `#category/social/FMfcg...`. A search or label query in list position that happens to be 16 or more alphanumerics, such as `#search/abcdefghijklmno123`, stays a list view.

`?` and everything after it is stripped before the hash is split on `/`, and each segment is decoded with `decodeURIComponent`.

Each view has a setting, in the popup under "Show on": `viewInbox` (on), `viewTabs` (on), `viewSearch` (on), `viewOther` (off). Settings live in `chrome.storage.local` and changes arrive on `chrome.storage.onChanged`. A view that is off sends no classify requests and gets its rows, chips, and bar restored and removed.

## Selectors

- Visible main: `div[role=main]` with a computed display other than `none`, a set `offsetParent`, and a `tr.zA` row inside. The first match wins.
- Visible list: the first `.Cp` in main that holds a `tr.zA` and has a set `offsetParent` or a non-empty `getClientRects()`. Gmail keeps several `.Cp` elements in the page (hidden tabs, previous views), so the first `.Cp` is usually not the live one. Only rows inside this list are ordered, chipped, or classified.
- Bar placement: the bar `div#gc-unread` is inserted as a child of the visible list's parent, immediately before the visible list. Switching views moves that same node, so only one bar ever exists.
- Rows: `tr.zA.zE` is an unread row, where `zA` is the row class and `zE` marks unread. Read rows are `tr.zA` without `zE` (seen as `zA yO`): they are never classified or chipped, but they take part in the order.
- Row thread id: the first `[data-thread-id]` inside the row, in practice on `span.bqe`. It identifies the row when the list's original order is recorded. A row without one takes no part in the order and drifts below the ordered rows.
- Sender: `span.zF[email][name]`. `name` is the display name, `email` the address.
- Subject and ids: `span.bqe[data-thread-id]`. Text content is the subject. Attributes used:
  - `data-thread-id`: with the last message id and the labels hash, forms the classification cache key.
  - `data-legacy-thread-id`: Gmail's own open-thread target.
  - `data-legacy-last-message-id`: the rest of the cache key.
- Subject cell: `div.y6` holds the subject, `span.bog` wraps it, and `span.bqe` is the subject element on unread rows. The chips span is inserted inside `div.y6`, immediately before the subject, falling back to immediately before `span.bog` or `span.bqe`.
- Snippet: `span.y2`, with nested `span.Zt` removed before reading text. `Zt` holds Gmail's leading separator.
- Date: the `title` of `td.xW span[title]`, falling back to the text of `td.xW`.
- A row missing the sender, the subject element, or any of the three ids is skipped.
- The script never touches row clicks or `location.hash`: Gmail's own row actions, selection, and navigation keep working on the rows it moves.

## Unread bar and row order

- The bar shows `N unread` for the unread rows of the visible list, `classifying N...` while a batch is in flight, and one error line when the last dispatch failed. Every write goes through `render()`, which rewrites the bar only when the count, the in-flight count, or the error text changes.
- Order: Gmail's own rows are moved inside their own `tbody` with `insertBefore`, never cloned and never moved to another table. Unread rows go first: critical rows first, where critical means `criticalProbability` at or above the threshold setting, sorted by urgency score descending then critical probability descending, then every other unread row, unclassified and failed rows included; then every read row. Inside the two non-critical groups rows keep Gmail's own relative order. Rows are only moved when the current order differs from that target.
- Original order: the first time a row is seen in a given list, its thread id is recorded with a position between its nearest already recorded neighbours, so the recorded order survives our own moves and rows that arrive later land near where Gmail put them. The list changes its tracking when the visible list node changes, and on disable, a view turned off, or navigation the recorded order is applied again before the chips and the bar are removed.
- Chips: a `span.gc-chips` inside each classified unread row holds a `Critical` badge on critical rows, one chip per label whose probability is at or above the threshold, and a `classifying` or `retrying` marker while the row has no result. A row that becomes read loses its chips. A row is rewritten only when its badge, chips, or marker change.
- Chip hue comes from a fixed set of eight hues indexed by the label's position in the settings list. The bar, the badge, and the chips mix their hue and `currentColor`, so they read on Gmail's light, dark, and custom themes.
- The labels themselves live in `chrome.storage.local` as `labels: { id, name, description }[]`, edited in the popup, capped at 15. Changes apply live. A label with an empty name or description is not saved; the popup shows an inline message and keeps the previous set.
- `render()` writes nothing when the order already matches, the bar text is unchanged, and every row carries the chips signature for its current state. After its own writes it drops the observer's pending records with `observer.takeRecords()`, and the observer ignores records inside the bar or carrying only `gc-` elements, so reordering cannot retrigger itself.

## Classify flow

- The content script sends `{ type: 'classify', emails, labels }` to the service worker and receives `{ ok: true, results, errors }` or `{ ok: false, error }`. Results are keyed by thread id plus last message id plus the labels hash.
- Batches of 20 rows go out one at a time, at most one dispatch in flight. Before each batch and after each response the loop checks that the extension is still enabled, the view is still on, the visible list node is unchanged, and the generation counter has not moved. The counter moves on `hashchange` and on any storage change to `enabled`, `labels`, or a view toggle, so a result that arrives after a navigation, a disable, or a label edit is dropped.
- Cache: `crit:` prefixed entries in `chrome.storage.local`. Editing labels changes the hash, so the visible rows reclassify; old entries stay until "Clear cache" removes them.
- Concurrent misses for the same cache key share one evaluate call. The worker rechecks storage before starting, reuses an in-flight promise, and drops the entry when the promise settles, so a failure is never cached.
- A failed row backs off: 60 s after the first failure, doubling per consecutive failure up to 10 min. After each dispatch the content script arms one timer for the earliest pending retry, replaces it on the next dispatch, and clears it when the bar is removed, the extension is disabled, or the view is off. A 401 or 403 on any row stops the whole batch: no worker dequeues further emails, calls already in flight may finish, and the content script halts until the `apiKey` setting changes. A missing key halts the same way.

## When Gmail changes

Check in this order:

1. Rows still match `tr.zA.zE`. If unread rows lose `zE` (or `zA`), they stop being classified and chipped and mix into the read rows.
2. The thread id still sits on `[data-thread-id]` inside the row, and `span.bqe` still carries all three `data-` ids. Missing ids mean the row is skipped and never ordered.
3. `div.y6` still holds the subject and `span.bog` still wraps it. If the subject cell is rewrapped, chips stop being inserted.
4. `span.y2` is still the snippet and `span.Zt` is still the separator to strip.
5. The visible `.Cp` is still the list container, so rows are still reordered and the bar still lands above the list. If Gmail wraps or renames it, nothing is injected on any view.
6. `div[role=main]` is still the visible list container.
7. Hash routes still look like `#inbox`, `#category/<name>`, `#search/<query>`, `#label/<name>`. A renamed route lands that view in "Labels and other folders" or switches the injection off.
