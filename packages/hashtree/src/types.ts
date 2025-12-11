/**
 * HashTree - Simple content-addressed merkle tree
 *
 * Core principle: Every node is stored by SHA256(msgpack(node)) -> msgpack(node)
 * This enables pure KV content-addressed storage.
 */
import type { TreeVisibility } from './visibility.js';
export type { TreeVisibility };

/**
 * 32-byte SHA256 hash used as content address
 */
export type Hash = Uint8Array;

/**
 * Content Identifier - hash + optional decryption key
 *
 * For public content: just the hash
 * For encrypted content: hash + CHK decryption key
 */
export interface CID {
  /** SHA256 hash of the (encrypted) content */
  hash: Hash;
  /** CHK decryption key (for encrypted content) */
  key?: Uint8Array;
}

/**
 * Create a CID from hash and optional key
 */
export function cid(hash: Hash, key?: Uint8Array): CID {
  return key ? { hash, key } : { hash };
}

/**
 * Node types in the tree
 */
export enum NodeType {
  /** Raw data blob (leaf) */
  Blob = 0,
  /** Tree node with links to children */
  Tree = 1,
}

/**
 * A link to a child node with optional metadata
 */
export interface Link {
  /** SHA256 hash of the child node's MessagePack encoding */
  hash: Hash;
  /** Optional name (for directory entries) */
  name?: string;
  /** Size of subtree in bytes (for efficient seeks) */
  size?: number;
  /** CHK decryption key (content hash) for encrypted nodes */
  key?: Uint8Array;
  /** Whether this link points to a TreeNode (true) or raw blob (false) */
  isTreeNode: boolean;
}

/**
 * Tree node - contains links to children
 * Stored as: SHA256(msgpack(TreeNode)) -> msgpack(TreeNode)
 *
 * For directories: links have names
 * For chunked files: links are ordered chunks
 * For large directories: links can be other tree nodes (fanout)
 */
export interface TreeNode {
  type: NodeType.Tree;
  /** Links to child nodes */
  links: Link[];
  /** Total size of all data in this subtree */
  totalSize?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Blob node - raw data (leaf)
 * Stored as: SHA256(data) -> data
 *
 * Note: Blobs are stored directly, not MessagePack-wrapped
 */
export interface BlobNode {
  type: NodeType.Blob;
  /** The raw data */
  data: Uint8Array;
}

/**
 * Union of all node types
 */
export type Node = TreeNode | BlobNode;

/**
 * Result of adding content to the tree
 */
export interface PutResult {
  /** Hash of the stored node */
  hash: Hash;
  /** Size of the stored data */
  size: number;
}

/**
 * Options for building trees
 */
export interface TreeOptions {
  /** Max links per tree node before splitting (default: 256) */
  fanout?: number;
  /** Max blob size before chunking (default: 256KB) */
  chunkSize?: number;
}

/**
 * Directory entry for building directory trees
 */
export interface DirEntry {
  name: string;
  hash: Hash;
  size: number;
  /** Whether this entry points to a TreeNode (true) or raw blob (false) */
  isTreeNode: boolean;
}

/**
 * Content-addressed key-value store interface
 */
export interface Store {
  /**
   * Store data by its hash
   * @returns true if newly stored, false if already existed
   */
  put(hash: Hash, data: Uint8Array): Promise<boolean>;

  /**
   * Retrieve data by hash
   * @returns data or null if not found
   */
  get(hash: Hash): Promise<Uint8Array | null>;

  /**
   * Check if hash exists
   */
  has(hash: Hash): Promise<boolean>;

  /**
   * Delete by hash
   * @returns true if deleted, false if didn't exist
   */
  delete(hash: Hash): Promise<boolean>;
}

/**
 * Extended store with metadata support (e.g., Blossom)
 */
export interface StoreWithMeta extends Store {
  /**
   * Store with content type
   */
  put(hash: Hash, data: Uint8Array, contentType?: string): Promise<boolean>;
}

/**
 * Hex string representation of a hash
 */
export type HashHex = string;

/**
 * Convert hash to hex string
 */
export function toHex(hash: Hash): HashHex {
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to hash
 */
export function fromHex(hex: HashHex): Hash {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Compare two hashes for equality
 */
export function hashEquals(a: Hash, b: Hash): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Entry returned from RefResolver.list()
 */
export interface RefResolverListEntry {
  key: string;
  cid: CID;
  /** Tree visibility: public, unlisted, or private */
  visibility?: TreeVisibility;
  /** Encrypted key for unlisted trees - decrypt with link key from URL */
  encryptedKey?: string;
  /** Key ID for unlisted trees */
  keyId?: string;
  /** Self-encrypted key for private trees - decrypt with NIP-04 */
  selfEncryptedKey?: string;
  /** Unix timestamp when the tree was created/last updated */
  createdAt?: number;
}

/**
 * Visibility info passed to subscribe callbacks
 */
export interface SubscribeVisibilityInfo {
  /** Tree visibility: public, unlisted, or private */
  visibility: TreeVisibility;
  /** Encrypted key for unlisted trees - decrypt with link key from URL */
  encryptedKey?: string;
  /** Key ID for unlisted trees */
  keyId?: string;
  /** Self-encrypted key for private/unlisted trees - decrypt with NIP-04 */
  selfEncryptedKey?: string;
}

/**
 * RefResolver - Maps human-readable keys to merkle root hashes (refs)
 *
 * This abstraction allows different backends (Nostr, DNS, HTTP, local storage)
 * to provide mutable pointers to immutable content-addressed data.
 *
 * Key format is implementation-specific, e.g.:
 * - Nostr: "npub1.../treename"
 * - DNS: "example.com/treename"
 * - Local: "local/mydata"
 *
 * All methods wait indefinitely until data is available - caller should apply timeout if needed.
 */
export interface RefResolver {
  /**
   * Resolve a key to its current CID.
   * Waits indefinitely until found - caller should apply timeout if needed.
   * @returns CID (never null - waits until found)
   */
  resolve(key: string): Promise<CID | null>;

  /**
   * Subscribe to CID changes for a key.
   * Callback fires immediately with current value (if available), then on each update.
   * Subscription stays open indefinitely until unsubscribed.
   *
   * @param key The key to watch
   * @param callback Called with new CID (or null if deleted/unavailable) and visibility info
   * @returns Unsubscribe function
   */
  subscribe(key: string, callback: (cid: CID | null, visibilityInfo?: SubscribeVisibilityInfo) => void): () => void;

  /**
   * Publish/update a CID (optional - only for writable backends)
   * @param key The key to publish to
   * @param cid The CID to publish
   * @param visibilityInfo Optional visibility info for list subscriptions
   * @param skipNostrPublish Optional - skip Nostr publish (caller handles separately)
   * @returns true if published successfully
   */
  publish?(key: string, cid: CID, visibilityInfo?: SubscribeVisibilityInfo, skipNostrPublish?: boolean): Promise<boolean>;

  /**
   * List all keys matching a prefix.
   * Streams results as they arrive - stays open indefinitely.
   * Callback fires on each new entry or update.
   *
   * @param prefix The prefix to watch (e.g., "npub1..." for all trees of a user)
   * @param callback Called with updated list as entries arrive (includes visibility info)
   * @returns Unsubscribe function
   */
  list?(prefix: string, callback: (entries: Array<RefResolverListEntry>) => void): () => void;

  /**
   * Stop the resolver and clean up resources
   */
  stop?(): void;

  /**
   * Inject a local list entry (for instant UI updates)
   * This makes trees appear immediately without waiting for network
   * @param entry The entry to inject with full visibility info
   */
  injectListEntry?(entry: RefResolverListEntry): void;
}
