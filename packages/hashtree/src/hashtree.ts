/**
 * HashTree - Unified merkle tree operations
 *
 * Single class for creating, reading, and editing content-addressed merkle trees.
 */

import { Store, Hash, TreeNode, Link, NodeType, toHex } from './types.js';
import { sha256 } from './hash.js';
import { encodeAndHash, decodeTreeNode, isTreeNode, isDirectoryNode } from './codec.js';

/** Default chunk size: 256KB */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;

/** Default max links per tree node (fanout) */
export const DEFAULT_MAX_LINKS = 174;

export interface HashTreeConfig {
  store: Store;
  /** Chunk size for splitting blobs */
  chunkSize?: number;
  /** Max links per tree node */
  maxLinks?: number;
}

export interface TreeEntry {
  name: string;
  hash: Hash;
  size?: number;
  isTree: boolean;
}

export interface DirEntry {
  name: string;
  hash: Hash;
  size?: number;
}

/**
 * HashTree - create, read, and edit merkle trees
 */
export class HashTree {
  private store: Store;
  private chunkSize: number;
  private maxLinks: number;

  constructor(config: HashTreeConfig) {
    this.store = config.store;
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.maxLinks = config.maxLinks ?? DEFAULT_MAX_LINKS;
  }

  // ============ CREATE ============

  /**
   * Store a blob directly (small data)
   */
  async putBlob(data: Uint8Array): Promise<Hash> {
    const hash = await sha256(data);
    await this.store.put(hash, data);
    return hash;
  }

  /**
   * Store a file, chunking if necessary
   */
  async putFile(data: Uint8Array): Promise<{ hash: Hash; size: number }> {
    const size = data.length;

    if (data.length <= this.chunkSize) {
      const hash = await this.putBlob(data);
      return { hash, size };
    }

    // Split into chunks
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const end = Math.min(offset + this.chunkSize, data.length);
      chunks.push(data.slice(offset, end));
      offset = end;
    }

    // Hash and store chunks in parallel
    const chunkHashes = await Promise.all(chunks.map(chunk => this.putBlob(chunk)));

    // Build tree from chunks
    const links: Link[] = chunkHashes.map((hash, i) => ({
      hash,
      size: i < chunkHashes.length - 1 ? this.chunkSize : data.length - i * this.chunkSize,
    }));

    const rootHash = await this.buildTree(links, size);
    return { hash: rootHash, size };
  }

  /**
   * Build a directory from entries
   */
  async putDirectory(entries: DirEntry[], metadata?: Record<string, unknown>): Promise<Hash> {
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    const links: Link[] = sorted.map(e => ({
      hash: e.hash,
      name: e.name,
      size: e.size,
    }));

    const totalSize = links.reduce((sum, l) => sum + (l.size ?? 0), 0);

    if (links.length <= this.maxLinks) {
      const node: TreeNode = {
        type: NodeType.Tree,
        links,
        totalSize,
        metadata,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);
      return hash;
    }

    // Large directory - split into chunks
    return this.buildDirectoryByChunks(links, totalSize, metadata);
  }

  private async buildTree(links: Link[], totalSize?: number): Promise<Hash> {
    if (links.length === 1 && links[0].size === totalSize) {
      return links[0].hash;
    }

    if (links.length <= this.maxLinks) {
      const node: TreeNode = {
        type: NodeType.Tree,
        links,
        totalSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);
      return hash;
    }

    const subTrees: Link[] = [];
    for (let i = 0; i < links.length; i += this.maxLinks) {
      const batch = links.slice(i, i + this.maxLinks);
      const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

      const node: TreeNode = {
        type: NodeType.Tree,
        links: batch,
        totalSize: batchSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);

      subTrees.push({ hash, size: batchSize });
    }

    return this.buildTree(subTrees, totalSize);
  }

  private async buildDirectoryByChunks(
    links: Link[],
    totalSize: number,
    metadata?: Record<string, unknown>
  ): Promise<Hash> {
    const subTrees: Link[] = [];

    for (let i = 0; i < links.length; i += this.maxLinks) {
      const batch = links.slice(i, i + this.maxLinks);
      const batchSize = batch.reduce((sum, l) => sum + (l.size ?? 0), 0);

      const node: TreeNode = {
        type: NodeType.Tree,
        links: batch,
        totalSize: batchSize,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);

      subTrees.push({ hash, name: `_chunk_${i}`, size: batchSize });
    }

    if (subTrees.length <= this.maxLinks) {
      const node: TreeNode = {
        type: NodeType.Tree,
        links: subTrees,
        totalSize,
        metadata,
      };
      const { data, hash } = await encodeAndHash(node);
      await this.store.put(hash, data);
      return hash;
    }

    return this.buildDirectoryByChunks(subTrees, totalSize, metadata);
  }

  // ============ READ ============

  /**
   * Get raw data by hash
   */
  async getBlob(hash: Hash): Promise<Uint8Array | null> {
    return this.store.get(hash);
  }

  /**
   * Get and decode a tree node
   */
  async getTreeNode(hash: Hash): Promise<TreeNode | null> {
    const data = await this.store.get(hash);
    if (!data) return null;
    if (!isTreeNode(data)) return null;
    return decodeTreeNode(data);
  }

  /**
   * Check if hash points to a tree node
   */
  async isTree(hash: Hash): Promise<boolean> {
    const data = await this.store.get(hash);
    if (!data) return false;
    return isTreeNode(data);
  }

  /**
   * Check if hash points to a directory (tree with named links)
   */
  async isDirectory(hash: Hash): Promise<boolean> {
    const data = await this.store.get(hash);
    if (!data) return false;
    return isDirectoryNode(data);
  }

  /**
   * Read a complete file (reassemble chunks if needed)
   */
  async readFile(hash: Hash): Promise<Uint8Array | null> {
    const data = await this.store.get(hash);
    if (!data) return null;

    if (!isTreeNode(data)) {
      return data;
    }

    const node = decodeTreeNode(data);
    return this.assembleChunks(node);
  }

  private async assembleChunks(node: TreeNode): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];

    for (const link of node.links) {
      const childData = await this.store.get(link.hash);
      if (!childData) {
        throw new Error(`Missing chunk: ${toHex(link.hash)}`);
      }

      if (isTreeNode(childData)) {
        const childNode = decodeTreeNode(childData);
        parts.push(await this.assembleChunks(childNode));
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
   * Read a file with streaming
   */
  async *readFileStream(hash: Hash): AsyncGenerator<Uint8Array> {
    const data = await this.store.get(hash);
    if (!data) return;

    if (!isTreeNode(data)) {
      yield data;
      return;
    }

    const node = decodeTreeNode(data);
    yield* this.streamChunks(node);
  }

  private async *streamChunks(node: TreeNode): AsyncGenerator<Uint8Array> {
    for (const link of node.links) {
      const childData = await this.store.get(link.hash);
      if (!childData) {
        throw new Error(`Missing chunk: ${toHex(link.hash)}`);
      }

      if (isTreeNode(childData)) {
        const childNode = decodeTreeNode(childData);
        yield* this.streamChunks(childNode);
      } else {
        yield childData;
      }
    }
  }

  /**
   * List directory entries
   */
  async listDirectory(hash: Hash): Promise<TreeEntry[]> {
    const node = await this.getTreeNode(hash);
    if (!node) return [];

    const entries: TreeEntry[] = [];

    for (const link of node.links) {
      // Skip internal chunk nodes
      if (link.name?.startsWith('_chunk_') || link.name?.startsWith('_')) {
        const subEntries = await this.listDirectory(link.hash);
        entries.push(...subEntries);
        continue;
      }

      const childIsDir = await this.isDirectory(link.hash);
      entries.push({
        name: link.name ?? toHex(link.hash),
        hash: link.hash,
        size: link.size,
        isTree: childIsDir,
      });
    }

    return entries;
  }

  /**
   * Resolve a path within a tree
   */
  async resolvePath(rootHash: Hash, path: string): Promise<Hash | null> {
    const parts = path.split('/').filter(p => p.length > 0);

    let currentHash = rootHash;

    for (const part of parts) {
      const node = await this.getTreeNode(currentHash);
      if (!node) return null;

      const link = node.links.find(l => l.name === part);
      if (!link) {
        // Check internal nodes
        const found = await this.findInSubtrees(node, part);
        if (!found) return null;
        currentHash = found;
      } else {
        currentHash = link.hash;
      }
    }

    return currentHash;
  }

  private async findInSubtrees(node: TreeNode, name: string): Promise<Hash | null> {
    for (const link of node.links) {
      if (!link.name?.startsWith('_')) continue;

      const subNode = await this.getTreeNode(link.hash);
      if (!subNode) continue;

      const found = subNode.links.find(l => l.name === name);
      if (found) return found.hash;

      const deepFound = await this.findInSubtrees(subNode, name);
      if (deepFound) return deepFound;
    }

    return null;
  }

  /**
   * Get total size of a tree
   */
  async getSize(hash: Hash): Promise<number> {
    const data = await this.store.get(hash);
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
      total += link.size ?? await this.getSize(link.hash);
    }
    return total;
  }

  /**
   * Walk entire tree depth-first
   */
  async *walk(
    hash: Hash,
    path: string = ''
  ): AsyncGenerator<{ path: string; hash: Hash; isTree: boolean; size?: number }> {
    const data = await this.store.get(hash);
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
        yield* this.walk(link.hash, path);
      } else {
        yield* this.walk(link.hash, childPath);
      }
    }
  }

  // ============ EDIT ============

  /**
   * Add or update an entry in a directory
   * @returns New root hash
   */
  async setEntry(
    rootHash: Hash,
    path: string[],
    name: string,
    hash: Hash,
    size: number,
    isTree = false
  ): Promise<Hash> {
    const dirHash = await this.resolvePathArray(rootHash, path);
    if (!dirHash) {
      throw new Error(`Path not found: ${path.join('/')}`);
    }

    const entries = await this.listDirectory(dirHash);
    const newEntries = entries
      .filter(e => e.name !== name)
      .map(e => ({ name: e.name, hash: e.hash, size: e.size ?? 0 }));

    newEntries.push({ name, hash, size });

    const newDirHash = await this.putDirectory(newEntries);
    return this.rebuildPath(rootHash, path, newDirHash);
  }

  /**
   * Remove an entry from a directory
   * @returns New root hash
   */
  async removeEntry(rootHash: Hash, path: string[], name: string): Promise<Hash> {
    const dirHash = await this.resolvePathArray(rootHash, path);
    if (!dirHash) {
      throw new Error(`Path not found: ${path.join('/')}`);
    }

    const entries = await this.listDirectory(dirHash);
    const newEntries = entries
      .filter(e => e.name !== name)
      .map(e => ({ name: e.name, hash: e.hash, size: e.size ?? 0 }));

    const newDirHash = await this.putDirectory(newEntries);
    return this.rebuildPath(rootHash, path, newDirHash);
  }

  /**
   * Rename an entry in a directory
   * @returns New root hash
   */
  async renameEntry(
    rootHash: Hash,
    path: string[],
    oldName: string,
    newName: string
  ): Promise<Hash> {
    if (oldName === newName) return rootHash;

    const dirHash = await this.resolvePathArray(rootHash, path);
    if (!dirHash) {
      throw new Error(`Path not found: ${path.join('/')}`);
    }

    const entries = await this.listDirectory(dirHash);
    const entry = entries.find(e => e.name === oldName);
    if (!entry) {
      throw new Error(`Entry not found: ${oldName}`);
    }

    const newEntries = entries
      .filter(e => e.name !== oldName)
      .map(e => ({ name: e.name, hash: e.hash, size: e.size ?? 0 }));

    newEntries.push({ name: newName, hash: entry.hash, size: entry.size ?? 0 });

    const newDirHash = await this.putDirectory(newEntries);
    return this.rebuildPath(rootHash, path, newDirHash);
  }

  /**
   * Move an entry to a different directory
   * @returns New root hash
   */
  async moveEntry(
    rootHash: Hash,
    sourcePath: string[],
    name: string,
    targetPath: string[]
  ): Promise<Hash> {
    const sourceDirHash = await this.resolvePathArray(rootHash, sourcePath);
    if (!sourceDirHash) {
      throw new Error(`Source path not found: ${sourcePath.join('/')}`);
    }

    const sourceEntries = await this.listDirectory(sourceDirHash);
    const entry = sourceEntries.find(e => e.name === name);
    if (!entry) {
      throw new Error(`Entry not found: ${name}`);
    }

    // Remove from source
    let newRoot = await this.removeEntry(rootHash, sourcePath, name);

    // Add to target
    newRoot = await this.setEntry(
      newRoot,
      targetPath,
      name,
      entry.hash,
      entry.size ?? 0,
      entry.isTree
    );

    return newRoot;
  }

  private async resolvePathArray(rootHash: Hash, path: string[]): Promise<Hash | null> {
    if (path.length === 0) return rootHash;
    return this.resolvePath(rootHash, path.join('/'));
  }

  private async rebuildPath(
    rootHash: Hash,
    path: string[],
    newChildHash: Hash
  ): Promise<Hash> {
    if (path.length === 0) {
      return newChildHash;
    }

    let childHash = newChildHash;
    const parts = [...path];

    while (parts.length > 0) {
      const childName = parts.pop()!;

      const parentHash = parts.length === 0
        ? rootHash
        : await this.resolvePathArray(rootHash, parts);

      if (!parentHash) {
        throw new Error(`Parent path not found: ${parts.join('/')}`);
      }

      const parentEntries = await this.listDirectory(parentHash);
      const newParentEntries: DirEntry[] = parentEntries.map(e =>
        e.name === childName
          ? { name: e.name, hash: childHash, size: e.size ?? 0 }
          : { name: e.name, hash: e.hash, size: e.size ?? 0 }
      );

      childHash = await this.putDirectory(newParentEntries);
    }

    return childHash;
  }

  // ============ UTILITY ============

  /**
   * Get the underlying store
   */
  getStore(): Store {
    return this.store;
  }
}

/**
 * Verify tree integrity - checks that all referenced hashes exist
 */
export async function verifyTree(
  store: Store,
  rootHash: Hash
): Promise<{ valid: boolean; missing: Hash[] }> {
  const missing: Hash[] = [];
  const visited = new Set<string>();

  async function check(hash: Hash): Promise<void> {
    const hex = toHex(hash);
    if (visited.has(hex)) return;
    visited.add(hex);

    const data = await store.get(hash);
    if (!data) {
      missing.push(hash);
      return;
    }

    if (isTreeNode(data)) {
      const node = decodeTreeNode(data);
      for (const link of node.links) {
        await check(link.hash);
      }
    }
  }

  await check(rootHash);

  return { valid: missing.length === 0, missing };
}
