# HashTree Explorer

Web-based file explorer for hashtree with P2P sync.

## Vision

P2P file sharing where hosting pays. Leave it running, serve content, earn sats.

- Content requests are paid (cashu/ecash)
- Popular files = higher storage priority
- Optional encryption for plausible deniability
- Peer accounting with settlement for bandwidth imbalances

## Current Status

Early prototype:
- [x] IndexedDB local storage
- [x] File/folder upload and browsing
- [x] WebM video recording via StreamBuilder
- [x] Nostr login and hashtree publishing (kind 30078)
- [x] URL routing with npub/treeName format
- [x] WebRTC P2P sync (in progress)
- [ ] Payment layer (cashu)
- [ ] Encrypted content hosting
- [ ] Storage prioritization by demand

## Development

```bash
# From repo root
npm run dev:example

# Run E2E tests
npm run test:e2e
```

## Why here?

Lives in hashtree repo for development convenience. May move to separate repo when it outgrows being an "example".
