# Chrome Web Store listing (draft)

Draft text for the store listing. Nothing here is published.

## Short description

Unread Gmail first, critical at the top, with your own labels, classified by TypeSafe Jev.

## Long description

Unread Gmail first, critical at the top.

Jev Inbox reorders the message list Gmail already shows. Unread mail moves above read mail, and the messages that matter most move above everything else: a person waiting on a reply, an invoice, a deadline, a security alert. Every classified row carries chips for your own labels, so a visa appointment and a bank statement can be spotted at a glance.

- Your views: inbox, other inbox tabs, search results, and labels and other folders, each switchable.
- Your labels: name a label, describe what belongs under it, and Jev answers one question per label.
- Your sensitivity: choose how confident a classification has to be before a row counts as critical.
- Your provider: Vercel AI Gateway or TypeSafe, with your own key.

Only the unread rows in the Gmail list currently loaded are classified, only their sender, subject, snippet and date are sent, and your label names and descriptions go with them as the criteria Jev answers. Results are cached in your browser. Email bodies and attachments are never read or sent. There is no account, no analytics, and no server of ours.

## Single purpose statement

Jev Inbox sorts and labels the unread messages Gmail already shows in the list currently loaded, and nothing else.

## Permission justifications

- `storage`: saves your settings (provider, API keys, enabled switch, sensitivity, view toggles, first-run acknowledgement), your labels, and the classification cache, all in `chrome.storage.local` in your own browser profile.
- `https://mail.google.com/*`: reads the rendered message list to identify unread rows and their sender, subject, snippet and date, reorders those rows, and injects the status bar and label chips.
- `https://ai-gateway.vercel.sh/*`: sends row metadata for classification when Vercel AI Gateway is the selected provider, using the user's own key.
- `https://api.typesafe.ai/*`: sends row metadata for classification when TypeSafe is the selected provider, using the user's own key.

No other hosts are requested. The extension makes no request to any server of its own.

## Data use disclosure answers

- What data is collected: message metadata from the Gmail list, specifically sender display name, sender address, subject, snippet and date of unread rows, plus the user's own label names and descriptions, which are sent as the criteria for the label questions. Not the body, not attachments, not the user's contacts, not their browsing history.
- How the data is used: sent to the AI provider the user selected, to classify each row as critical or not, how urgent it is, and which of the user's labels it belongs to, where each label name and description is the criteria for that label's answer. Results are shown in the Gmail list.
- Is data sold to third parties: no.
- Is data used or transferred for purposes unrelated to the item's single purpose: no.
- Is data used or transferred to determine creditworthiness or for lending purposes: no.
- Transfer to third parties: only to the AI provider the user selected (Vercel AI Gateway or TypeSafe), under the user's own key and account, and only for classification.
- Authentication information: the provider API key the user pastes is stored locally in `chrome.storage.local` and sent only to that provider as an authorization header. The popup keeps only the last four characters of each key so it can show that a key is saved without reading it back.
- Personal communications: message metadata of unread rows is sent to the selected provider for classification, together with the user's label names and descriptions as criteria. Message content is not read or sent.
- Storage and deletion: settings, keys, labels and the classification cache stay in the browser. "Clear cache" deletes cached classifications, which sends the unread rows of the current list through classification again, and removing the extension deletes all of it.

## Images

Built by `npm run store-images` from the sources in `dev/store/`. Screenshots are made-up mail only, no real inbox.

- `docs/store/01-unread-first.png` (1280x800): the store listing's hero screenshot.
- `docs/store/02-your-labels.png` (1280x800): screenshot 2.
- `docs/store/03-dark-theme.png` (1280x800): screenshot 3.
- `docs/store/04-privacy.png` (1280x800): screenshot 4.
- `docs/store/05-your-key.png` (1280x800): screenshot 5.
- `docs/store/promo-small.png` (440x280): the small promo tile.
- `docs/store/promo-marquee.png` (1400x560): the marquee promo tile.
