# BEP52 (BitTorrent v2) Merkle Tree

hashtree includes an optional BEP52-compatible merkle tree implementation for BitTorrent v2 interoperability.

## Overview

BEP52 defines the merkle tree format used in BitTorrent v2 torrents. Key differences from the default hashtree format:

| Aspect | Default HashTree | BEP52 |
|--------|------------------|-------|
| Block size | 256 KB | 16 KB |
| Tree structure | Variable fanout (CBOR) | Binary tree |
| Padding | None | Zero-padded to power of 2 |
| Hash format | SHA256(CBOR(node)) | SHA256(left \|\| right) |
| Piece layers | No | Yes (optional) |

## Usage

### Basic Usage

```typescript
import { Bep52TreeBuilder, BEP52_BLOCK_SIZE } from 'hashtree';

const builder = new Bep52TreeBuilder();
const result = await builder.buildFromData(fileData);

console.log(result.root);       // pieces root hash (32 bytes)
console.log(result.size);       // file size
console.log(result.blockCount); // number of 16KB blocks
console.log(result.leafHashes); // array of block hashes
```

### With Storage

```typescript
import { Bep52TreeBuilder, MemoryStore } from 'hashtree';

const store = new MemoryStore();
const builder = new Bep52TreeBuilder({ store });

const result = await builder.buildFromData(fileData);
// Blocks are now stored in `store` by their SHA256 hash
```

### Streaming Builder

For large files without loading into memory:

```typescript
import { Bep52StreamBuilder } from 'hashtree';

const stream = new Bep52StreamBuilder({ store });

// Append chunks as they arrive
await stream.append(chunk1);
await stream.append(chunk2);
// ...

const result = await stream.finalize();
```

### Piece Layers

For torrent creation with custom piece sizes:

```typescript
const builder = new Bep52TreeBuilder({
  store,
  pieceSize: 256 * 1024, // 256KB pieces (must be power of 2, >= 16KB)
});

const result = await builder.buildFromData(fileData);
console.log(result.pieceLayers); // hashes at piece boundaries
```

### Low-level Merkle Functions

For advanced use cases, low-level functions are available via namespace import:

```typescript
import { bep52 } from 'hashtree';

// Tree structure utilities
const numLeafs = bep52.merkleNumLeafs(blockCount);
const parent = bep52.merkleGetParent(nodeIndex);
const sibling = bep52.merkleGetSibling(nodeIndex);

// Hash operations
const combined = await bep52.merkleHashPair(left, right);
const root = await bep52.merkleRoot(leafHashes, numLeafs);

// Proof generation/verification
const tree = await bep52.merkleBuildTree(leafHashes);
const proof = bep52.merkleGetProof(tree, leafIndex, numLeafs);
const valid = await bep52.merkleVerifyProof(leaf, leafIndex, proof, root, numLeafs);
```

## Performance

BEP52 is slower than default hashtree due to 16x more blocks:

```
MemoryStore (10 MB):
  TreeBuilder: 17ms (41 blocks)
  BEP52:       95ms (640 blocks)

With IndexedDB (~0.5ms/transaction):
  TreeBuilder: 25ms
  BEP52:       350ms
```

For performance-critical applications:
1. Use `MemoryStore` during tree building
2. Flush to IndexedDB in batches afterward
3. Or use hash-only mode (no store) if you only need the root

## Compatibility

The implementation matches libtorrent's BEP52 merkle tree:
- SHA256 hash algorithm
- Binary tree with branching factor 2
- Zero-padding for incomplete trees
- Same flat tree indexing scheme

## References

- [BEP 52: The BitTorrent Protocol Specification v2](https://www.bittorrent.org/beps/bep_0052.html)
- [libtorrent merkle.cpp](https://github.com/arvidn/libtorrent/blob/master/src/merkle.cpp)
