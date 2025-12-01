/**
 * HashTree - Simple content-addressed merkle tree storage
 *
 * Browser-first, ESM-only library for building merkle trees
 * with content-hash addressing: SHA256(content) -> content
 */

// Core types
export type {
  Hash,
  TreeNode,
  BlobNode,
  Link,
  Store,
  StoreWithMeta,
  RefResolver,
  // Legacy alias
  RefResolver as RootResolver,
} from './types.js';

export {
  NodeType,
  toHex,
  fromHex,
} from './types.js';

// Hash utilities
export { sha256 } from './hash.js';

// CBOR codec
export {
  encodeTreeNode,
  decodeTreeNode,
  encodeAndHash,
  isTreeNode,
  isDirectoryNode,
} from './codec.js';

// Storage adapters
export { MemoryStore } from './store/memory.js';
export { IndexedDBStore, type IndexedDBStoreOptions } from './store/indexeddb.js';
export {
  BlossomStore,
  type BlossomStoreConfig,
  type BlossomServer,
  type BlossomSigner,
  type BlossomAuthEvent,
} from './store/blossom.js';

// HashTree - unified tree operations (create, read, edit)
export {
  HashTree,
  verifyTree,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_LINKS,
  type HashTreeConfig,
  type TreeEntry,
  type DirEntry,
} from './hashtree.js';

// Legacy aliases for backward compatibility
export { HashTree as TreeBuilder } from './hashtree.js';
export { HashTree as TreeReader } from './hashtree.js';
export { HashTree as TreeEditor } from './hashtree.js';

// StreamBuilder for incremental file building
export { StreamBuilder, BEP52_CHUNK_SIZE } from './builder.js';

// WebRTC P2P store
export {
  WebRTCStore,
  Peer,
  PeerId,
  generateUuid,
  type SignalingMessage,
  type WebRTCStoreConfig,
  type PeerStatus,
  type WebRTCStoreEvent,
  type WebRTCStoreEventHandler,
  type EventSigner,
  type EventEncrypter,
  type EventDecrypter,
} from './webrtc/index.js';

// BEP52 (BitTorrent v2) compatible merkle tree
// Main API: Bep52TreeBuilder, Bep52StreamBuilder
// Low-level functions available via: import { bep52 } from 'hashtree'
export {
  BEP52_BLOCK_SIZE,
  ZERO_HASH,
  Bep52TreeBuilder,
  Bep52StreamBuilder,
  type Bep52Result,
  type Bep52Config,
} from './bep52.js';

// Re-export low-level BEP52 merkle functions as namespace
export * as bep52 from './bep52.js';

// Ref resolvers
export {
  createNostrRefResolver,
  // Legacy alias
  createNostrRefResolver as createNostrRootResolver,
  type NostrRefResolverConfig,
  // Legacy alias
  type NostrRefResolverConfig as NostrRootResolverConfig,
  type NostrEvent,
  type NostrFilter,
  type Nip19Like,
} from './resolver/index.js';
