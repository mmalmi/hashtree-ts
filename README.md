# hashtree-ts

Content-addressed merkle tree storage for the browser.

## Design

- **SHA256** hashing via Web Crypto API
- **MessagePack** encoding for tree nodes (deterministic)
- **Simple**: No multicodec, multibase, or CID versioning
- **Dumb storage**: Works with any key-value store (hash → bytes). Unlike BitTorrent, no active merkle proof computation needed—just store and retrieve blobs by hash.
- **16KB chunks** by default: Fits WebRTC data channel limits and matches BitTorrent v2 piece size.

## Packages

- `hashtree` - Core merkle tree library
- `hashtree-dexie` - IndexedDB/Dexie storage adapter
- `hashtree-web` - Web app with Nostr integration

## Storage Backends

The `Store` interface is just `get(hash) → bytes` and `put(hash, bytes)`. Implementations:

- `MemoryStore` - In-memory
- `DexieStore` - IndexedDB via Dexie (in `hashtree-dexie`)
- `OpfsStore` - Origin Private File System
- `BlossomStore` - Remote blossom server
- `WebRTCStore` - P2P network (fetches from peers)

## Usage

```typescript
import { MemoryStore, HashTree, toHex } from 'hashtree';

const store = new MemoryStore();
const tree = new HashTree({ store, chunkSize: 1024 });

// Store a file
const data = new TextEncoder().encode('Hello, World!');
const cid = await tree.put(data);
console.log('Hash:', toHex(cid.hash));

// Read it back
const content = await tree.get(cid);

// Create a directory
const dirCid = await tree.putDirectory([
  { name: 'hello.txt', hash: cid.hash, size: cid.size },
]);

// List directory
const entries = await tree.listDirectory(dirCid.hash);
```

## Tree Nodes

Every stored item is either raw bytes or a tree node. Tree nodes are MessagePack-encoded with a `type` field:

- `Blob` (0) - Raw data chunk (not a tree node, just bytes)
- `File` (1) - Chunked file: links are unnamed, ordered by byte offset
- `Dir` (2) - Directory: links have names, may point to files or subdirs

Wire format: `{t: LinkType, l: [{h: hash, s: size, n?: name, t: linkType, ...}], s?: totalSize}`

## P2P Transport (WebRTC)

The core library is transport-agnostic—any system that can fetch bytes by hash works. `WebRTCStore` is one implementation using WebRTC with Nostr signaling:

```typescript
import { WebRTCStore } from 'hashtree';

const store = new WebRTCStore({
  signer,           // NIP-07 compatible
  pubkey,
  encrypt,          // NIP-04
  decrypt,
  localStore,       // Fallback store
  relays: ['wss://relay.example.com'],
});

await store.start();
const data = await store.get(hash);  // Fetches from peers
```

**Request forwarding**: Peers forward requests they can't fulfill locally. HTL (Hops-To-Live, default 10) limits propagation depth. Uses Freenet-style probabilistic decrement—each peer randomly decides whether to decrement at HTL boundaries, making it harder to infer request origin.

## Development

```bash
npm install      # Install dependencies
npm test         # Run tests
npm run build    # Build
npm run dev      # Dev server
npm run test:e2e # E2E tests
```

## License

MIT
