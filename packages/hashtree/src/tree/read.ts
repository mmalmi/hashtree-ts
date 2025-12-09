/**
 * Tree reading operations
 */

import { Store, Hash, TreeNode, toHex, CID, cid } from '../types.js';
import { decodeTreeNode, isTreeNode, isDirectoryNode } from '../codec.js';

export interface TreeEntry {
  name: string;
  cid: CID;
  size?: number;
  isTree: boolean;
}

/**
 * Get raw data by hash
 */
export async function getBlob(store: Store, hash: Hash): Promise<Uint8Array | null> {
  return store.get(hash);
}

/**
 * Get and decode a tree node
 */
export async function getTreeNode(store: Store, hash: Hash): Promise<TreeNode | null> {
  const data = await store.get(hash);
  if (!data) return null;
  if (!isTreeNode(data)) return null;
  return decodeTreeNode(data);
}

/**
 * Check if hash points to a tree node
 */
export async function isTree(store: Store, hash: Hash): Promise<boolean> {
  if (!hash) return false;
  const data = await store.get(hash);
  if (!data) return false;
  return isTreeNode(data);
}

/**
 * Check if hash points to a directory (tree with named links)
 */
export async function isDirectory(store: Store, hash: Hash): Promise<boolean> {
  if (!hash) return false;
  const data = await store.get(hash);
  if (!data) return false;
  return isDirectoryNode(data);
}

/**
 * Read a complete file (reassemble chunks if needed)
 */
export async function readFile(store: Store, hash: Hash): Promise<Uint8Array | null> {
  if (!hash) return null;
  const data = await store.get(hash);
  if (!data) return null;

  if (!isTreeNode(data)) {
    return data;
  }

  const node = decodeTreeNode(data);
  return assembleChunks(store, node);
}

async function assembleChunks(store: Store, node: TreeNode): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for (const link of node.links) {
    const childData = await store.get(link.hash);
    if (!childData) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    if (isTreeNode(childData)) {
      const childNode = decodeTreeNode(childData);
      parts.push(await assembleChunks(store, childNode));
    } else {
      parts.push(childData);
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
 * Read a file with streaming, optionally starting from an offset
 */
export async function* readFileStream(store: Store, hash: Hash, offset: number = 0): AsyncGenerator<Uint8Array> {
  const data = await store.get(hash);
  if (!data) return;

  if (!isTreeNode(data)) {
    if (offset >= data.length) return;
    yield offset > 0 ? data.slice(offset) : data;
    return;
  }

  const node = decodeTreeNode(data);
  yield* streamChunksWithOffset(store, node, offset);
}

/**
 * Stream chunks starting from an offset
 * Uses link.size to efficiently skip chunks before offset
 */
async function* streamChunksWithOffset(
  store: Store,
  node: TreeNode,
  offset: number
): AsyncGenerator<Uint8Array> {
  let position = 0;

  for (const link of node.links) {
    const linkSize = link.size ?? 0;

    // If we haven't reached offset yet and can skip this entire subtree
    if (linkSize > 0 && position + linkSize <= offset) {
      position += linkSize;
      continue;
    }

    const childData = await store.get(link.hash);
    if (!childData) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    if (isTreeNode(childData)) {
      const childNode = decodeTreeNode(childData);
      // Recurse with adjusted offset
      const childOffset = Math.max(0, offset - position);
      yield* streamChunksWithOffset(store, childNode, childOffset);
      position += linkSize;
    } else {
      // Leaf chunk
      const chunkStart = position;
      const chunkEnd = position + childData.length;
      position = chunkEnd;

      if (chunkEnd <= offset) {
        // Entire chunk is before offset, skip
        continue;
      }

      if (chunkStart >= offset) {
        // Entire chunk is after offset, yield all
        yield childData;
      } else {
        // Partial chunk - slice from offset
        const sliceStart = offset - chunkStart;
        yield childData.slice(sliceStart);
      }
    }
  }
}

/**
 * Read a range of bytes from a file
 */
export async function readFileRange(
  store: Store,
  hash: Hash,
  start: number,
  end?: number
): Promise<Uint8Array | null> {
  const data = await store.get(hash);
  if (!data) return null;

  if (!isTreeNode(data)) {
    // Single blob
    if (start >= data.length) return new Uint8Array(0);
    const actualEnd = end !== undefined ? Math.min(end, data.length) : data.length;
    return data.slice(start, actualEnd);
  }

  const node = decodeTreeNode(data);
  return readRangeFromNode(store, node, start, end);
}

async function readRangeFromNode(
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

    const linkSize = link.size ?? 0;

    // Skip chunks entirely before start
    if (linkSize > 0 && position + linkSize <= start) {
      position += linkSize;
      continue;
    }

    const childData = await store.get(link.hash);
    if (!childData) {
      throw new Error(`Missing chunk: ${toHex(link.hash)}`);
    }

    if (isTreeNode(childData)) {
      const childNode = decodeTreeNode(childData);
      const childStart = Math.max(0, start - position);
      const childEnd = end !== undefined ? end - position : undefined;
      const childData2 = await readRangeFromNode(store, childNode, childStart, childEnd);
      if (childData2.length > 0) {
        const take = Math.min(childData2.length, maxBytes - bytesCollected);
        parts.push(childData2.slice(0, take));
        bytesCollected += take;
      }
      position += linkSize;
    } else {
      // Leaf chunk
      const chunkStart = position;
      const chunkEnd = position + childData.length;
      position = chunkEnd;

      if (chunkEnd <= start) {
        continue;
      }

      // Calculate slice bounds within this chunk
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = end !== undefined
        ? Math.min(childData.length, end - chunkStart)
        : childData.length;

      if (sliceStart < sliceEnd) {
        const take = Math.min(sliceEnd - sliceStart, maxBytes - bytesCollected);
        parts.push(childData.slice(sliceStart, sliceStart + take));
        bytesCollected += take;
      }
    }
  }

  // Concatenate parts
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
 * List directory entries
 */
export async function listDirectory(store: Store, hash: Hash): Promise<TreeEntry[]> {
  const node = await getTreeNode(store, hash);
  if (!node) return [];

  const entries: TreeEntry[] = [];

  for (const link of node.links) {
    // Skip internal chunk nodes
    if (link.name?.startsWith('_chunk_') || link.name?.startsWith('_')) {
      const subEntries = await listDirectory(store, link.hash);
      entries.push(...subEntries);
      continue;
    }

    // Use stored isTree flag if available, otherwise check dynamically
    const childIsDir = link.isTree ?? await isDirectory(store, link.hash);
    entries.push({
      name: link.name ?? toHex(link.hash),
      cid: cid(link.hash, link.key),
      size: link.size,
      isTree: childIsDir,
    });
  }

  return entries;
}

/**
 * Resolve a path within a tree
 */
export async function resolvePath(store: Store, rootHash: Hash, path: string): Promise<Hash | null> {
  const parts = path.split('/').filter(p => p.length > 0);

  let currentHash = rootHash;

  for (const part of parts) {
    const node = await getTreeNode(store, currentHash);
    if (!node) return null;

    const link = node.links.find(l => l.name === part);
    if (!link) {
      // Check internal nodes
      const found = await findInSubtrees(store, node, part);
      if (!found) return null;
      currentHash = found;
    } else {
      currentHash = link.hash;
    }
  }

  return currentHash;
}

async function findInSubtrees(store: Store, node: TreeNode, name: string): Promise<Hash | null> {
  for (const link of node.links) {
    if (!link.name?.startsWith('_')) continue;

    const subNode = await getTreeNode(store, link.hash);
    if (!subNode) continue;

    const found = subNode.links.find(l => l.name === name);
    if (found) return found.hash;

    const deepFound = await findInSubtrees(store, subNode, name);
    if (deepFound) return deepFound;
  }

  return null;
}

/**
 * Get total size of a tree
 */
export async function getSize(store: Store, hash: Hash): Promise<number> {
  const data = await store.get(hash);
  if (!data) return 0;

  if (!isTreeNode(data)) {
    return data.length;
  }

  const node = decodeTreeNode(data);
  if (node.totalSize !== undefined) {
    return node.totalSize;
  }

  let total = 0;
  for (const link of node.links) {
    total += link.size ?? await getSize(store, link.hash);
  }
  return total;
}

/**
 * Walk entire tree depth-first
 */
export async function* walk(
  store: Store,
  hash: Hash,
  path: string = ''
): AsyncGenerator<{ path: string; hash: Hash; isTree: boolean; size?: number }> {
  const data = await store.get(hash);
  if (!data) return;

  if (!isTreeNode(data)) {
    yield { path, hash, isTree: false, size: data.length };
    return;
  }

  const node = decodeTreeNode(data);
  yield { path, hash, isTree: true, size: node.totalSize };

  for (const link of node.links) {
    const childPath = link.name
      ? (path ? `${path}/${link.name}` : link.name)
      : path;

    // Skip internal chunk nodes in path
    if (link.name?.startsWith('_chunk_') || link.name?.startsWith('_')) {
      yield* walk(store, link.hash, path);
    } else {
      yield* walk(store, link.hash, childPath);
    }
  }
}
