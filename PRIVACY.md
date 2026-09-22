# Privacy

Jev Inbox reads the message list Gmail renders and sends a small amount of metadata about unread rows to an AI provider so those rows can be classified. Nothing is sent until you accept the first-run notice in the popup. This page describes exactly what happens, and it is written so it can serve as the Chrome Web Store privacy policy.

## What is collected and sent

For each unread row Gmail shows on the current page, and only for rows the extension has not classified before:

- sender display name
- sender address
- subject
- the snippet Gmail renders in the list
- the date Gmail shows for the row

Nothing else. Email bodies are never read, never collected, and never sent. Attachments are never touched. No account, no email address of yours, no identifiers of your browser or device, and no browsing history are collected.

## Where it goes

The row metadata goes to exactly one destination, the provider you select in the popup:

- Vercel AI Gateway (`https://ai-gateway.vercel.sh`), using the AI Gateway key you pasted, or
- TypeSafe (`https://api.typesafe.ai`), using the TypeSafe key you pasted.

Both act as processors. Requests are made under your own key and your own account, so the provider's terms and data policies apply to them. Jev Inbox has no servers of its own: nothing is proxied, relayed, or stored anywhere except your browser and the provider you chose. No analytics, no telemetry, no tracking, no advertising identifiers.

"Test connection" in the popup sends one fixed dummy state (the text of a connection test) and no email data.

## What is stored locally

Everything the extension keeps lives in `chrome.storage.local`, inside your browser profile:

- settings: provider choice, your provider API keys, the enabled switch, the sensitivity threshold, the per-view toggles, and the first-run acknowledgement
- your labels: name and description
- the classification cache: one entry per classified row, keyed by thread id, last message id, provider, and a hash of your labels, with a timestamp. The service worker trims the cache to 4000 entries once it passes 5000, deleting the oldest first.

The content script on Gmail reads the named settings and the cache entries. Only the service worker reads your API keys, and only to call the provider you selected.

## How to delete everything

- "Clear cache" in the popup removes every cached classification. Your settings and labels stay.
- Removing the extension from `chrome://extensions` deletes its storage, including your keys, labels, and the cache.
- Clearing the site data for Gmail or your browser profile also removes the extension's storage.

## Changes

If what is sent or stored changes, this page changes with it, and the change is visible in the repository history.
