# hashtree-ts

Content-addressed merkle tree storage library for the browser.

## Design Philosophy

**Simple over clever.** SHA256 for hashing, MessagePack for encoding. No multicodec, multibase, or CID versioning. One way to do things.

**Core does one thing.** Merkle trees over any key-value store. That's it. The library doesn't know about networks, peers, or protocols.

**Composition over integration.** Want WebRTC sync? Nostr discovery? Blossom storage? Those are separate layers that *use* hashtree, not part of it. You pick what you need.

**Read the code in an afternoon.** If you can't understand the entire codebase quickly, it's too complex. No abstraction astronautics.

## Features

- SHA256 hashing via Web Crypto API
- MessagePack encoding for tree nodes (deterministic, fast)
- File chunking with configurable size
- Directory support with nested trees
- Streaming append for large files
- Tree verification
- BEP52 (BitTorrent v2) compatible binary merkle algorithm (experimental)
- CHK (Content Hash Key) deterministic encryption (experimental)

## Storage Adapters

- `MemoryStore` - In-memory storage
- `IndexedDBStore` - Browser IndexedDB persistence
- `BlossomStore` - Remote blossom server storage
- `WebRTCStore` - P2P sync via WebRTC with Nostr signaling

## Installation

```bash
npm install hashtree
```

## Usage

```typescript
import { MemoryStore, HashTree, toHex } from 'hashtree';

const store = new MemoryStore();
const tree = new HashTree({ store, chunkSize: 1024 });

// Store a file
const data = new TextEncoder().encode('Hello, World!');
const { hash, size } = await tree.putFile(data);
console.log('File hash:', toHex(hash));

// Read it back
const content = await tree.readFile(hash);
console.log(new TextDecoder().decode(content));

// Create a directory
const dirHash = await tree.putDirectory([
  { name: 'hello.txt', hash, size },
]);

// List directory
const entries = await tree.listDirectory(dirHash);
console.log(entries);

// Resolve path
const fileHash = await tree.resolvePath(dirHash, 'hello.txt');
```

### Streaming

```typescript
import { StreamBuilder } from 'hashtree';

const stream = new StreamBuilder({ store, chunkSize: 1024 });

await stream.append(new TextEncoder().encode('chunk 1'));
await stream.append(new TextEncoder().encode('chunk 2'));

const { hash, size } = await stream.finalize();
```

### Verification

```typescript
import { verifyTree } from 'hashtree';

const { valid, missing } = await verifyTree(store, rootHash);
if (!valid) {
  console.log('Missing chunks:', missing.map(toHex));
}
```

### BEP52 Binary Merkle Algorithm

For BitTorrent v2 compatibility exploration, the builder supports a binary merkle algorithm using 16KB chunks and power-of-2 padded hash pairs:

```typescript
import { TreeBuilder, BEP52_CHUNK_SIZE } from 'hashtree';

const builder = new TreeBuilder({
  store,
  chunkSize: BEP52_CHUNK_SIZE,  // 16KB
  merkleAlgorithm: 'binary',    // BEP52-style hash pairs
});

const { hash, size, leafHashes } = await builder.putFile(data);
```

Note: Binary mode computes root hashes only (no intermediate nodes stored). Use default mode for full tree traversal with TreeReader.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run example app
npm run dev:example

# Run E2E tests
npm run test:e2e
```

## License

MIT
