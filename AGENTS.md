# Development

## Commands
```bash
pnpm install      # Install dependencies
pnpm test         # Run tests
pnpm run build    # Build
pnpm run dev      # Dev server
pnpm run test:e2e # E2E tests
```

## Structure
- `packages/hashtree` - Core library
- `packages/iris-files` - Web app (Iris Files)
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
- Playwright runs its own dev server - no need to `pnpm run dev` when running tests
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

### Test Parallelism
- **Tests MUST pass with 100% workers** (full parallelism) for fast execution and iteration
- Use `--workers=1` only when debugging specific test failures
- The "others pool" (non-followed peers) fills up with connections from parallel test instances
- **Required for all tests**:
  - Use `disableOthersPool(page)` helper in test-utils.ts after `page.goto('/')` to prevent WebRTC cross-talk
  - Use `setupPageErrorHandler(page)` to filter expected relay errors
  - Wait for specific conditions, never use arbitrary delays
  - Use `test.slow()` for tests with complex async operations (video streaming, multi-user WebRTC)
- Multi-user tests should have users follow each other before any WebRTC-dependent operations
- Nostr relay errors (rate-limiting, pow requirements) are expected and filtered by `setupPageErrorHandler`
- temp.iris.to relay is generally tolerant and reliable for tests
- git-push-htree test requires cargo/rust installed - skip if not available

### Flaky Tests
- **Tests MUST pass under full parallelism** - do not rely on retries
- If a test fails under parallelism, investigate the root cause with console logs and screenshots
- Common causes of flaky multi-user tests:
  - Resolver not receiving tree data before navigation - verify tree visibility before navigating
  - OPFS stale data - clear OPFS alongside IndexedDB in test setup
  - WebRTC connection not established - wait for specific connection indicators
- Global timeout is 30s, with `test.slow()` tripling it to 90s
- Blossom servers require whitelisting for write access - tests cannot use Blossom for sync
