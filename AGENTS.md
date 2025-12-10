# Development

## Commands
```bash
npm install      # Install dependencies
npm test         # Run tests
npm run build    # Build
npm run dev      # Dev server
npm run test:e2e # E2E tests
```

## Structure
- `packages/hashtree` - Core library
- `packages/hashtree-web` - Web app
- `e2e/` - Playwright tests

## Design
- **Simple**: SHA256 + MessagePack, no multicodec/CID versioning
- **Focused**: Merkle trees over key-value stores, nothing else
- **Composable**: WebRTC/Nostr/Blossom are separate layers

## App Principles
- **Offline-first**: All ops succeed locally, sync when online
- **Optimistic**: Never await network, fire-and-forget publishes
- **Local source of truth**: `treeRootCache.ts` owns merkle roots

## Code Style
- UnoCSS: use `b-` prefix for borders
- Buttons: ALWAYS use `btn-ghost` class (default) or `btn-primary`/`btn-danger`/`btn-success` for colored buttons (defined in uno.config.ts). Never use raw styles like `bg-transparent border-none` on buttons. For clickable elements that shouldn't look like buttons (e.g., avatar links), use `<a>` tags instead.

## Testing
- When tests are failing, increasing timeouts is usually not the solution. The app should work fast
- Debug failing / flaky tests with console logs, further tests or playwrght screenshots and fix. If you suspect nostr relay issue, debug with local mock or real relay
- Playwright test in headless mode
- App autoconnects to other instances p2p over nostr relays and webrtc which may interfere with some tests. One option is to make it connect only to followed users in webrtc transport settings, or test in offline mode.
- TDD is a good idea: write failing test first, then write code that makes it pass

### Test Performance
- **NEVER use `waitForTimeout()` for arbitrary delays** - always wait for specific conditions
- Use `expect(locator).toBeVisible()`, `toContainText()`, or `page.waitForURL()` instead
- WebRTC/Nostr sync between users requires them to **follow each other** for reliable connections
- For collaborative tests: users follow each other, then only one user needs to set editors
