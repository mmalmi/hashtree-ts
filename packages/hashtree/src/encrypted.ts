/**
 * CHK (Content Hash Key) encrypted file operations for HashTree
 *
 * Everything uses CHK encryption:
 * - Chunks: key = SHA256(plaintext)
 * - Tree nodes: key = SHA256(cbor_encoded_node)
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
  const { store, chunkSize, maxLinks } = config;
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
 * Stream an encrypted file
 * @param store - Storage backend
 * @param hash - Root hash of encrypted file
 * @param key - CHK decryption key (content hash)
 */
export async function* readFileEncryptedStream(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): AsyncGenerator<Uint8Array> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return;

  // CHK decrypt
  const decrypted = await decryptChk(encryptedData, key);

  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    yield* streamEncryptedChunks(store, node);
  } else {
    // Single blob (small file)
    yield decrypted;
  }
}

async function* streamEncryptedChunks(
  store: Store,
  node: TreeNode
): AsyncGenerator<Uint8Array> {
  for (const link of node.links) {
    const chunkKey = link.key;
    if (!chunkKey) {
      throw new Error(`Missing decryption key for chunk: ${toHex(link.hash)}`);
    }

    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    // CHK decrypt the child
    const decrypted = await decryptChk(encryptedChild, chunkKey);

    if (isTreeNode(decrypted)) {
      const childNode = decodeTreeNode(decrypted);
      yield* streamEncryptedChunks(store, childNode);
    } else {
      yield decrypted;
    }
  }
}
