/**
 * Encrypted file operations for HashTree
 *
 * Adds encryption methods to HashTree instances via composition.
 * All nodes (leaf chunks AND tree structure) are encrypted with AES-256-GCM.
 */

import { Store, Hash, TreeNode, Link, NodeType, toHex } from './types.js';
import { sha256 } from './hash.js';
import { encodeAndHash, decodeTreeNode, isTreeNode } from './codec.js';
import { encrypt, decrypt, generateKey, type EncryptionKey } from './crypto.js';

export interface EncryptedTreeConfig {
  store: Store;
  chunkSize: number;
  maxLinks: number;
}

/**
 * Store a file with encryption (all nodes encrypted including tree structure)
 * @param config - Tree configuration
 * @param data - File data to encrypt and store
 * @param key - Optional 32-byte encryption key (generated if not provided)
 * @returns Hash of encrypted root and the encryption key
 */
export async function putFileEncrypted(
  config: EncryptedTreeConfig,
  data: Uint8Array,
  key?: EncryptionKey
): Promise<{ hash: Hash; size: number; key: EncryptionKey }> {
  const encKey = key ?? generateKey();
  const { store, chunkSize, maxLinks } = config;

  if (data.length <= chunkSize) {
    // Small file - single encrypted blob
    const encrypted = await encrypt(data, encKey);
    const hash = await sha256(encrypted);
    await store.put(hash, encrypted);
    return { hash, size: data.length, key: encKey };
  }

  // Split into chunks, encrypt each
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + chunkSize, data.length);
    chunks.push(data.slice(offset, end));
    offset = end;
  }

  // Encrypt and store chunks in parallel
  const encryptedChunks = await Promise.all(
    chunks.map(async (chunk) => {
      const encrypted = await encrypt(chunk, encKey);
      const hash = await sha256(encrypted);
      await store.put(hash, encrypted);
      return { hash, size: encrypted.length };
    })
  );

  // Build tree from encrypted chunk hashes (tree nodes also encrypted)
  const links: Link[] = encryptedChunks.map((c) => ({
    hash: c.hash,
    size: c.size,
  }));

  const rootHash = await buildEncryptedTree(config, links, data.length, encKey);
  return { hash: rootHash, size: data.length, key: encKey };
}

/**
 * Build tree structure with encrypted tree nodes
 */
async function buildEncryptedTree(
  config: EncryptedTreeConfig,
  links: Link[],
  totalSize: number | undefined,
  key: EncryptionKey
): Promise<Hash> {
  const { store, maxLinks } = config;

  if (links.length === 1 && links[0].size === totalSize) {
    return links[0].hash;
  }

  if (links.length <= maxLinks) {
    const node: TreeNode = {
      type: NodeType.Tree,
      links,
      totalSize,
    };
    const { data } = await encodeAndHash(node);
    // Encrypt the tree node
    const encrypted = await encrypt(data, key);
    const hash = await sha256(encrypted);
    await store.put(hash, encrypted);
    return hash;
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
    // Encrypt the subtree node
    const encrypted = await encrypt(data, key);
    const hash = await sha256(encrypted);
    await store.put(hash, encrypted);

    subTrees.push({ hash, size: batchSize });
  }

  return buildEncryptedTree(config, subTrees, totalSize, key);
}

/**
 * Read an encrypted file (all nodes including tree structure are encrypted)
 * @param store - Storage backend
 * @param hash - Root hash of encrypted file
 * @param key - 32-byte decryption key
 * @returns Decrypted file data
 */
export async function readFileEncrypted(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): Promise<Uint8Array | null> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return null;

  // Decrypt the data
  const decrypted = await decrypt(encryptedData, key);

  // Check if decrypted data is a tree node
  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    return assembleEncryptedChunks(store, node, key);
  }

  // Single blob (small file)
  return decrypted;
}

async function assembleEncryptedChunks(
  store: Store,
  node: TreeNode,
  key: EncryptionKey
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for (const link of node.links) {
    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    // Decrypt the child
    const decrypted = await decrypt(encryptedChild, key);

    if (isTreeNode(decrypted)) {
      // Intermediate tree node
      const childNode = decodeTreeNode(decrypted);
      parts.push(await assembleEncryptedChunks(store, childNode, key));
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
 * @param key - 32-byte decryption key
 */
export async function* readFileEncryptedStream(
  store: Store,
  hash: Hash,
  key: EncryptionKey
): AsyncGenerator<Uint8Array> {
  const encryptedData = await store.get(hash);
  if (!encryptedData) return;

  // Decrypt the data
  const decrypted = await decrypt(encryptedData, key);

  if (isTreeNode(decrypted)) {
    const node = decodeTreeNode(decrypted);
    yield* streamEncryptedChunks(store, node, key);
  } else {
    // Single blob (small file)
    yield decrypted;
  }
}

async function* streamEncryptedChunks(
  store: Store,
  node: TreeNode,
  key: EncryptionKey
): AsyncGenerator<Uint8Array> {
  for (const link of node.links) {
    const encryptedChild = await store.get(link.hash);
    if (!encryptedChild) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    // Decrypt the child
    const decrypted = await decrypt(encryptedChild, key);

    if (isTreeNode(decrypted)) {
      const childNode = decodeTreeNode(decrypted);
      yield* streamEncryptedChunks(store, childNode, key);
    } else {
      yield decrypted;
    }
  }
}
