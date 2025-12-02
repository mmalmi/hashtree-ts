/**
 * Tree creation operations
 */

import { Store, Hash, TreeNode, Link, NodeType } from '../types.js';
import { sha256 } from '../hash.js';
import { encodeAndHash } from '../codec.js';

export interface CreateConfig {
  store: Store;
  chunkSize: number;
  maxLinks: number;
}

export interface DirEntry {
  name: string;
  hash: Hash;
  size?: number;
}

/**
 * Store a blob directly (small data)
 */
export async function putBlob(store: Store, data: Uint8Array): Promise<Hash> {
  const hash = await sha256(data);
  await store.put(hash, data);
  return hash;
}

/**
 * Store a file, chunking if necessary
 */
export async function putFile(
  config: CreateConfig,
  data: Uint8Array
): Promise<{ hash: Hash; size: number }> {
  const { store, chunkSize } = config;
  const size = data.length;

  if (data.length <= chunkSize) {
    const hash = await putBlob(store, data);
    return { hash, size };
  }

  // Split into chunks
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + chunkSize, data.length);
    chunks.push(data.slice(offset, end));
    offset = end;
  }

  // Hash and store chunks in parallel
  const chunkHashes = await Promise.all(chunks.map(chunk => putBlob(store, chunk)));

  // Build tree from chunks
  const links: Link[] = chunkHashes.map((hash, i) => ({
    hash,
    size: i < chunkHashes.length - 1 ? chunkSize : data.length - i * chunkSize,
  }));

  const rootHash = await buildTree(config, links, size);
  return { hash: rootHash, size };
}

/**
 * Build a directory from entries
 */
export async function putDirectory(
  config: CreateConfig,
  entries: DirEntry[],
  metadata?: Record<string, unknown>
): Promise<Hash> {
  const { store, maxLinks } = config;
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const links: Link[] = sorted.map(e => ({
    hash: e.hash,
    name: e.name,
    size: e.size,
  }));

  const totalSize = links.reduce((sum, l) => sum + (l.size ?? 0), 0);

  if (links.length <= maxLinks) {
    const node: TreeNode = {
      type: NodeType.Tree,
      links,
      totalSize,
      metadata,
    };
    const { data, hash } = await encodeAndHash(node);
    await store.put(hash, data);
    return hash;
  }

  // Large directory - split into chunks
  return buildDirectoryByChunks(config, links, totalSize, metadata);
}

export async function buildTree(
  config: CreateConfig,
  links: Link[],
  totalSize?: number
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
    const { data, hash } = await encodeAndHash(node);
    await store.put(hash, data);
    return hash;
  }

  const subTrees: Link[] = [];
  for (let i = 0; i < links.length; i += maxLinks) {
    const batch = links.slice(i, i + maxLinks);
    const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

    const node: TreeNode = {
      type: NodeType.Tree,
      links: batch,
      totalSize: batchSize,
    };
    const { data, hash } = await encodeAndHash(node);
    await store.put(hash, data);

    subTrees.push({ hash, size: batchSize });
  }

  return buildTree(config, subTrees, totalSize);
}

async function buildDirectoryByChunks(
  config: CreateConfig,
  links: Link[],
  totalSize: number,
  metadata?: Record<string, unknown>
): Promise<Hash> {
  const { store, maxLinks } = config;
  const subTrees: Link[] = [];

  for (let i = 0; i < links.length; i += maxLinks) {
    const batch = links.slice(i, i + maxLinks);
    const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

    const node: TreeNode = {
      type: NodeType.Tree,
      links: batch,
      totalSize: batchSize,
    };
    const { data, hash } = await encodeAndHash(node);
    await store.put(hash, data);

    subTrees.push({ hash, name: `_chunk_${i}`, size: batchSize });
  }

  if (subTrees.length <= maxLinks) {
    const node: TreeNode = {
      type: NodeType.Tree,
      links: subTrees,
      totalSize,
      metadata,
    };
    const { data, hash } = await encodeAndHash(node);
    await store.put(hash, data);
    return hash;
  }

  return buildDirectoryByChunks(config, subTrees, totalSize, metadata);
}
