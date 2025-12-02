/**
 * HashTree - Simple content-addressed merkle tree
 *
 * Core principle: Every node is stored by SHA256(CBOR(node)) -> CBOR(node)
 * This enables pure KV content-addressed storage.
 */

/**
 * 32-byte SHA256 hash used as content address
 */
export type Hash = Uint8Array;

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
  /** SHA256 hash of the child node's CBOR encoding */
  hash: Hash;
  /** Optional name (for directory entries) */
  name?: string;
  /** Size of subtree in bytes (for efficient seeks) */
  size?: number;
}

/**
 * Tree node - contains links to children
 * Stored as: SHA256(CBOR(TreeNode)) -> CBOR(TreeNode)
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
 * Note: Blobs are stored directly, not CBOR-wrapped
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
   * Resolve a key to its current root hash.
   * Waits indefinitely until a hash is found - caller should apply timeout if needed.
   * @returns Hash (never null - waits until found)
   */
  resolve(key: string): Promise<Hash | null>;

  /**
   * Subscribe to root hash changes for a key.
   * Callback fires immediately with current value (if available), then on each update.
   * Subscription stays open indefinitely until unsubscribed.
   *
   * @param key The key to watch
   * @param callback Called with new hash (or null if deleted/unavailable)
   * @returns Unsubscribe function
   */
  subscribe(key: string, callback: (hash: Hash | null) => void): () => void;

  /**
   * Publish/update a root hash (optional - only for writable backends)
   * @returns true if published successfully
   */
  publish?(key: string, hash: Hash): Promise<boolean>;

  /**
   * List all keys matching a prefix.
   * Streams results as they arrive - stays open indefinitely.
   * Callback fires on each new entry or update.
   *
   * @param prefix The prefix to watch (e.g., "npub1..." for all trees of a user)
   * @param callback Called with updated list as entries arrive
   * @returns Unsubscribe function
   */
  list?(prefix: string, callback: (entries: Array<{ key: string; hash: Hash }>) => void): () => void;

  /**
   * Stop the resolver and clean up resources
   */
  stop?(): void;
}
