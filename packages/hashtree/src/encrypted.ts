/**
 * CHK (Content Hash Key) encrypted file operations for HashTree
 *
 * Everything uses CHK encryption:
 * - Chunks: key = SHA256(plaintext)
 * - Tree nodes: key = SHA256(msgpack_encoded_node)
 *
 * Same content → same ciphertext → deduplication works at all levels.
 * The root key is deterministic: same file = same CID (hash + key).
 */

import { Store, Hash, TreeNode, Link, NodeType, toHex } from './types.js';
import { sha256 } from './hash.js';
import { encodeAndHash, decodeTreeNode, isTreeNode } from './codec.js';
import { encryptChk, decryptChk, type EncryptionKey } from './crypto.js';

export interface EncryptedTreeConfig {
  store: Store;
  chunkSize: number;
  maxLinks: number;
}

/**
 * Result of encrypted file storage
 */
export interface EncryptedPutResult {
  /** Root hash of encrypted tree */
  hash: Hash;
  /** Original plaintext size */
  size: number;
  /** Encryption key for the root (content hash for CHK) */
  key: EncryptionKey;
}

/**
 * Store a file with CHK encryption
 *
 * Everything is CHK encrypted - deterministic, enables full deduplication.
 * Returns hash + key, both derived from content.
 *
 * @param config - Tree configuration
 * @param data - File data to encrypt and store
 * @returns Hash of encrypted root and the encryption key (content hash)
 */
export async function putFileEncrypted(
  config: EncryptedTreeConfig,
  data: Uint8Array
): Promise<EncryptedPutResult> {
  const { store, chunkSize } = config;
  const size = data.length;

  // Single chunk - use CHK directly
  if (data.length <= chunkSize) {
    const { ciphertext, key } = await encryptChk(data);
    const hash = await sha256(ciphertext);
    await store.put(hash, ciphertext);
    return { hash, size, key };
  }

  // Multiple chunks - each chunk gets CHK
  const links: Link[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + chunkSize, data.length);
    const chunk = data.slice(offset, end);

    // CHK encrypt this chunk
    const { ciphertext, key: chunkKey } = await encryptChk(chunk);
    const hash = await sha256(ciphertext);
    const encSize = ciphertext.length;

    await store.put(hash, ciphertext);

    // Link stores both hash (location) and key (for decryption)
    links.push({
      hash,
      size: encSize,
      key: chunkKey,
    });

    offset = end;
  }

  // Build tree - tree nodes also CHK encrypted
  const { hash: rootHash, key: rootKey } = await buildEncryptedTree(config, links, size);

  return { hash: rootHash, size, key: rootKey };
}

/**
 * Build tree structure with CHK-encrypted tree nodes
 * Returns hash and key for the root node
 */
async function buildEncryptedTree(
  config: EncryptedTreeConfig,
  links: Link[],
  totalSize: number | undefined
): Promise<{ hash: Hash; key: EncryptionKey }> {
  const { store, maxLinks } = config;

  // Single link - return its hash and key directly
  if (links.length === 1 && links[0].key) {
    if (totalSize !== undefined && links[0].size === totalSize) {
      return { hash: links[0].hash, key: links[0].key };
    }
  }

  if (links.length <= maxLinks) {
    const node: TreeNode = {
      type: NodeType.Tree,
      links,
      totalSize,
    };
    const { data } = await encodeAndHash(node);
    // CHK encrypt the tree node
    const { ciphertext, key: nodeKey } = await encryptChk(data);
    const hash = await sha256(ciphertext);
    await store.put(hash, ciphertext);
    return { hash, key: nodeKey };
  }

  // Too many links - create subtrees
  const subTrees: Link[] = [];
  for (let i = 0; i < links.length; i += maxLinks) {
    const batch = links.slice(i, i + maxLinks);
    const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

    const node: TreeNode = {
      type: NodeType.Tree,
      links: batch,
      totalSize: batchSize,
    };
    const { data } = await encodeAndHash(node);
    // CHK encrypt the subtree node
    const { ciphertext, key: nodeKey } = await encryptChk(data);
    const hash = await sha256(ciphertext);
    await store.put(hash, ciphertext);

    subTrees.push({
      hash,
      size: batchSize,
      key: nodeKey,
    });
  }

  return buildEncryptedTree(config, subTrees, totalSize);
}

/**
 * Read an encrypted file
 *
 * Key is always the CHK key (content hash of plaintext)
 *
 * @param store - Storage backend
 * @param hash - Root hash of encrypted file
 * @param key - CHK decryption key (content hash)
 * @returns Decrypted file data
 */
export async function readFileEncrypted(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): Promise<Uint8Array | null> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return null;

  // CHK decrypt
  const decrypted = await decryptChk(encryptedData, key);

  // Check if it's a tree node
  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    return assembleEncryptedChunks(store, node);
  }

  // Single chunk data
  return decrypted;
}

/**
 * Check if decrypted data is a directory node (TreeNode with named links)
 */
function isDirectoryBlob(data: Uint8Array): boolean {
  if (!isTreeNode(data)) return false;
  const node = decodeTreeNode(data);
  // Directory has named links (or is empty), chunked blob has unnamed links
  return node.links.length === 0 || node.links[0].name !== undefined;
}

/**
 * Get directory node from encrypted storage, handling chunked directories
 */
async function getEncryptedDirectoryNode(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): Promise<TreeNode | null> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return null;

  const decrypted = await decryptChk(encryptedData, key);

  // Check if it's directly a directory (small directory)
  if (isDirectoryBlob(decrypted)) {
    return decodeTreeNode(decrypted);
  }

  // It's a chunk tree - could be a chunked directory
  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    const assembled = await assembleEncryptedChunks(store, node);

    // Check if assembled result is a directory
    if (isDirectoryBlob(assembled)) {
      return decodeTreeNode(assembled);
    }
  }

  return null; // Not a directory
}

/**
 * Assemble chunks from an encrypted tree
 * Each link has its own CHK key
 */
async function assembleEncryptedChunks(
  store: Store,
  node: TreeNode
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for (const link of node.links) {
    const chunkKey = link.key;
    if (!chunkKey) {
      throw new Error(`Missing decryption key for chunk: ${toHex(link.hash)}`);
    }

    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    const decrypted = await decryptChk(encryptedChild, chunkKey);

    if (isTreeNode(decrypted)) {
      // Intermediate tree node - recurse
      const childNode = decodeTreeNode(decrypted);
      parts.push(await assembleEncryptedChunks(store, childNode));
    } else {
      // Leaf data chunk
      parts.push(decrypted);
    }
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/**
 * Stream an encrypted file, optionally starting from an offset
 * @param store - Storage backend
 * @param hash - Root hash of encrypted file
 * @param key - CHK decryption key (content hash)
 * @param offset - Byte offset to start streaming from
 */
export async function* readFileEncryptedStream(
  store: Store,
  hash: Hash,
  key: EncryptionKey,
  offset: number = 0
): AsyncGenerator<Uint8Array> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return;

  // CHK decrypt
  const decrypted = await decryptChk(encryptedData, key);

  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    yield* streamEncryptedChunksWithOffset(store, node, offset);
  } else {
    // Single blob (small file)
    if (offset >= decrypted.length) return;
    yield offset > 0 ? decrypted.slice(offset) : decrypted;
  }
}

/**
 * Stream encrypted chunks starting from an offset
 */
async function* streamEncryptedChunksWithOffset(
  store: Store,
  node: TreeNode,
  offset: number
): AsyncGenerator<Uint8Array> {
  let position = 0;

  for (const link of node.links) {
    const chunkKey = link.key;
    if (!chunkKey) {
      throw new Error(`Missing decryption key for chunk: ${toHex(link.hash)}`);
    }

    const linkSize = link.size ?? 0;

    // Skip chunks entirely before offset
    if (linkSize > 0 && position + linkSize <= offset) {
      position += linkSize;
      continue;
    }

    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    const decrypted = await decryptChk(encryptedChild, chunkKey);

    if (isTreeNode(decrypted)) {
      const childNode = decodeTreeNode(decrypted);
      const childOffset = Math.max(0, offset - position);
      yield* streamEncryptedChunksWithOffset(store, childNode, childOffset);
      position += linkSize;
    } else {
      const chunkStart = position;
      const chunkEnd = position + decrypted.length;
      position = chunkEnd;

      if (chunkEnd <= offset) {
        continue;
      }

      if (chunkStart >= offset) {
        yield decrypted;
      } else {
        const sliceStart = offset - chunkStart;
        yield decrypted.slice(sliceStart);
      }
    }
  }
}

/**
 * Read a range of bytes from an encrypted file
 */
export async function readFileEncryptedRange(
  store: Store,
  hash: Hash,
  key: EncryptionKey,
  start: number,
  end?: number
): Promise<Uint8Array | null> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return null;

  const decrypted = await decryptChk(encryptedData, key);

  if (!isTreeNode(decrypted)) {
    // Single blob
    if (start >= decrypted.length) return new Uint8Array(0);
    const actualEnd = end !== undefined ? Math.min(end, decrypted.length) : decrypted.length;
    return decrypted.slice(start, actualEnd);
  }

  const node = decodeTreeNode(decrypted);
  return readEncryptedRangeFromNode(store, node, start, end);
}

async function readEncryptedRangeFromNode(
  store: Store,
  node: TreeNode,
  start: number,
  end?: number
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let position = 0;
  let bytesCollected = 0;
  const maxBytes = end !== undefined ? end - start : Infinity;

  for (const link of node.links) {
    if (bytesCollected >= maxBytes) break;

    const chunkKey = link.key;
    if (!chunkKey) {
      throw new Error(`Missing decryption key for chunk: ${toHex(link.hash)}`);
    }

    const linkSize = link.size ?? 0;

    // Skip chunks entirely before start
    if (linkSize > 0 && position + linkSize <= start) {
      position += linkSize;
      continue;
    }

    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    const decrypted = await decryptChk(encryptedChild, chunkKey);

    if (isTreeNode(decrypted)) {
      const childNode = decodeTreeNode(decrypted);
      const childStart = Math.max(0, start - position);
      const childEnd = end !== undefined ? end - position : undefined;
      const childData = await readEncryptedRangeFromNode(store, childNode, childStart, childEnd);
      if (childData.length > 0) {
        const take = Math.min(childData.length, maxBytes - bytesCollected);
        parts.push(childData.slice(0, take));
        bytesCollected += take;
      }
      position += linkSize;
    } else {
      const chunkStart = position;
      const chunkEnd = position + decrypted.length;
      position = chunkEnd;

      if (chunkEnd <= start) {
        continue;
      }

      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = end !== undefined
        ? Math.min(decrypted.length, end - chunkStart)
        : decrypted.length;

      if (sliceStart < sliceEnd) {
        const take = Math.min(sliceEnd - sliceStart, maxBytes - bytesCollected);
        parts.push(decrypted.slice(sliceStart, sliceStart + take));
        bytesCollected += take;
      }
    }
  }

  // Concatenate parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let concatOffset = 0;
  for (const part of parts) {
    result.set(part, concatOffset);
    concatOffset += part.length;
  }

  return result;
}

/**
 * Directory entry with optional encryption key
 */
export interface EncryptedDirEntry {
  name: string;
  hash: Hash;
  size?: number;
  /** CHK key for encrypted children */
  key?: Uint8Array;
  /** Whether this entry is a directory (tree) */
  isTree?: boolean;
}

/**
 * Store a directory with CHK encryption
 *
 * The directory node itself is encrypted. Child entries already have their own keys.
 * Large directories are chunked by bytes like files using putFileEncrypted.
 *
 * @param config - Tree configuration
 * @param entries - Directory entries (with keys for encrypted children)
 * @param metadata - Optional metadata
 * @returns Hash of encrypted directory and the encryption key
 */
export async function putDirectoryEncrypted(
  config: EncryptedTreeConfig,
  entries: EncryptedDirEntry[],
  metadata?: Record<string, unknown>
): Promise<EncryptedPutResult> {
  const { store, chunkSize } = config;
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const links: Link[] = sorted.map(e => ({
    hash: e.hash,
    name: e.name,
    size: e.size,
    key: e.key,
    isTree: e.isTree,
  }));

  const totalSize = links.reduce((sum, l) => sum + (l.size ?? 0), 0);

  const node: TreeNode = {
    type: NodeType.Tree,
    links,
    totalSize,
    metadata,
  };
  const { data } = await encodeAndHash(node);

  // Small directory - encrypt and store directly
  if (data.length <= chunkSize) {
    const { ciphertext, key } = await encryptChk(data);
    const hash = await sha256(ciphertext);
    await store.put(hash, ciphertext);
    return { hash, size: totalSize, key };
  }

  // Large directory - reuse putFileEncrypted for chunking
  return putFileEncrypted(config, data);
}

/**
 * List directory entries from an encrypted directory
 *
 * Handles both small directories (single node) and large directories
 * (chunked by bytes like files).
 *
 * @param store - Storage backend
 * @param hash - Hash of encrypted directory
 * @param key - CHK decryption key
 * @returns Directory entries with their encryption keys
 */
export async function listDirectoryEncrypted(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): Promise<EncryptedDirEntry[]> {
  const node = await getEncryptedDirectoryNode(store, hash, key);
  if (!node) return [];

  // Extract directory entries from the node
  const entries: EncryptedDirEntry[] = [];
  for (const link of node.links) {
    if (link.name) {
      entries.push({
        name: link.name,
        hash: link.hash,
        size: link.size,
        key: link.key,
        isTree: link.isTree,
      });
    }
  }

  return entries;
}

/**
 * Get a tree node from encrypted storage
 *
 * @param store - Storage backend
 * @param hash - Hash of encrypted node
 * @param key - CHK decryption key
 * @returns Decrypted tree node
 */
export async function getTreeNodeEncrypted(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): Promise<TreeNode | null> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return null;

  const decrypted = await decryptChk(encryptedData, key);

  if (!isTreeNode(decrypted)) {
    return null;
  }

  return decodeTreeNode(decrypted);
}
