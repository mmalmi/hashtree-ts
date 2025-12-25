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
- Buttons: use `btn-ghost` (default) or `btn-primary`/`btn-danger`/`btn-success`
- Don't add comments that aren't relevant without context

## Verify Changes
```bash
pnpm run lint
pnpm run build > /dev/null
```

## Testing
- Playwright runs its own dev server
- Run tests selectively: `pnpm run test:e2e -- e2e/specific-file.spec.ts`
- Always verify changes with e2e tests
- Kill dev servers before tests to avoid port conflicts
- TDD: write failing test first, then fix

### Test Rules
- NEVER use `waitForTimeout()` - wait for specific conditions
- Tests MUST pass with full parallelism
- Use `disableOthersPool(page)` after `page.goto('/')`
- Use `setupPageErrorHandler(page)` to filter relay errors
- Use `test.slow()` for complex async operations
- Multi-user tests: users must follow each other before WebRTC ops
- Global timeout 30s, `test.slow()` triples to 90s
