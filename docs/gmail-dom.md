# Gmail DOM

The content script reads the inbox list out of Gmail's rendered markup. It only acts on unread rows in the inbox view. Everything below is brittle by nature: Gmail ships obfuscated class names and changes them without notice.

## Selectors

- Visible main: `div[role=main]` with a computed display other than `none`, a set `offsetParent`, and a `tr.zA` row inside. The first match wins.
- Rows: `tr.zA.zE` inside that main. `zA` is the row class, `zE` marks unread. Read rows are `tr.zA` without `zE` (seen as `zA yO`), and are ignored.
- Container: the first `.Cp` element in main. The section is inserted as its previous sibling, so it sits above the list. The section root is `div#gc-critical`.
- Sender: `span.zF[email][name]`. `name` is the display name, `email` the address.
- Subject and ids: `span.bqe[data-thread-id]`. Text content is the subject. Attributes used:
  - `data-thread-id`: with the last message id, forms the classification cache key.
  - `data-legacy-thread-id`: the click target for opening the thread.
  - `data-legacy-last-message-id`: the rest of the cache key.
- Snippet: `span.y2`, with nested `span.Zt` removed before reading text. `Zt` holds Gmail's leading separator.
- Date: the `title` of `td.xW span[title]`, falling back to the text of `td.xW`.
- A row missing the sender, the subject element, or any of the three ids is skipped.

## When Gmail changes

Check in this order:

1. Rows still match `tr.zA.zE`. If unread rows lose `zE` (or `zA`), the section goes empty and stops updating.
2. `span.zF` still carries `email` and `name`, and `span.bqe` still carries all three `data-` ids. Missing ids mean every row is skipped.
3. `span.y2` is still the snippet and `span.Zt` is still the separator to strip.
4. The first `.Cp` element is still the list container, so the section still lands above the rows.
5. `div[role=main]` is still the visible inbox container.
