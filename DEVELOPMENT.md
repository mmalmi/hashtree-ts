# Development Guidelines

## Design Philosophy

### Simple over clever
SHA256 for hashing, CBOR for encoding. No multicodec, multibase, or CID versioning. One way to do things.

### Core does one thing
Merkle trees over any key-value store. That's it. The library doesn't know about networks, peers, or protocols.

### Composition over integration
Want WebRTC sync? Nostr discovery? Blossom storage? Those are separate layers that *use* hashtree, not part of it. You pick what you need.

### Read the code in an afternoon
If you can't understand the entire codebase quickly, it's too complex. No abstraction astronautics.

## App Design Principles

### Offline-first
The app must work offline. All operations should succeed locally first, then sync when connectivity is available.

### Optimistic updates
Never block the UI waiting for network operations. Update local state immediately, publish to network in the background.

- Don't await Nostr publishes - fire and forget
- Update local caches immediately after user actions
- Network failures should not break local functionality

### Single source of truth for merkle roots
`treeRootCache.ts` is the single source of truth for the current merkle root of each tree.

- All writes update `treeRootCache` immediately via `autosaveIfOwn()`
- Publishing to Nostr is throttled (1 second debounce)
- Multiple rapid updates result in a single publish
- `publishTreeRoot()` is the ONLY function that publishes roots to Nostr

### Local-first data
- All data lives in IndexedDB first
- Nostr/network is for sync and discovery, not primary storage
- User should be able to use the app indefinitely offline

### UnoCSS conventions
Use `b-` prefix for borders, not `border`:
```
b-1 b-solid b-surface-3    // correct
border border-surface-3     // won't work
```

## Code Style

### Avoid over-engineering
- Only make changes directly requested or clearly necessary
- Don't add features, refactor code, or make "improvements" beyond what was asked
- A bug fix doesn't need surrounding code cleaned up
- A simple feature doesn't need extra configurability
- Don't add docstrings, comments, or type annotations to code you didn't change
- Only add comments where the logic isn't self-evident

### Keep it minimal
- Don't add error handling for scenarios that can't happen
- Trust internal code and framework guarantees
- Only validate at system boundaries (user input, external APIs)
- Don't create helpers or abstractions for one-time operations
- Don't design for hypothetical future requirements
- Three similar lines of code is better than a premature abstraction

### Clean deletions
- If something is unused, delete it completely
- No backwards-compatibility hacks like renaming unused `_vars`
- No `// removed` comments for removed code
- No re-exporting types that aren't used

## Development Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run web app dev server
npm run dev

# Run E2E tests (auto-starts dev server)
npm run test:e2e
```

## Project Structure

- `packages/hashtree` - Core library (merkle trees, stores, WebRTC)
- `packages/hashtree-web` - Web application
- `e2e/` - Playwright end-to-end tests
- `docs/` - Additional documentation
