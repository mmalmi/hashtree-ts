/**
 * HashTree - Unified merkle tree operations
 *
 * Single class for creating, reading, and editing content-addressed merkle trees.
 *
 * All files are encrypted by default using CHK (Content Hash Key) encryption.
 * Use the "Public" variants (putFilePublic, readFilePublic) for unencrypted storage.
 */

import { Store, Hash, CID, TreeNode, toHex, cid } from './types.js';
import { decodeTreeNode, isTreeNode } from './codec.js';
import * as create from './tree/create.js';
import * as read from './tree/read.js';
import * as edit from './tree/edit.js';
import {
  putFileEncrypted,
  readFileEncrypted,
  readFileEncryptedStream,
  putDirectoryEncrypted,
  listDirectoryEncrypted,
  getTreeNodeEncrypted,
  type EncryptedDirEntry,
} from './encrypted.js';
import * as editEncrypted from './tree/editEncrypted.js';

/** Default chunk size: 256KB */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;

/** Default max links per tree node (fanout) */
export const DEFAULT_MAX_LINKS = 174;

export interface HashTreeConfig {
  store: Store;
  chunkSize?: number;
  maxLinks?: number;
}

export interface TreeEntry {
  name: string;
  cid: CID;
  size?: number;
  isTree: boolean;
}

export interface DirEntry {
  name: string;
  cid: CID;
  size?: number;
  isTree?: boolean;
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

  private get config(): create.CreateConfig {
    return { store: this.store, chunkSize: this.chunkSize, maxLinks: this.maxLinks };
  }

  // Create (encrypted by default)

  async putBlob(data: Uint8Array): Promise<Hash> {
    return create.putBlob(this.store, data);
  }

  /**
   * Store a file
   * @param data - File data to store
   * @param options - { public?: boolean } - if true, store without encryption
   * @returns { cid, size }
   */
  async putFile(
    data: Uint8Array,
    options?: { public?: boolean }
  ): Promise<{ cid: CID; size: number }> {
    if (options?.public) {
      const result = await create.putFile(this.config, data);
      return { cid: { hash: result.hash }, size: result.size };
    }
    const result = await putFileEncrypted(this.config, data);
    return { cid: cid(result.hash, result.key), size: result.size };
  }

  /**
   * Store a directory
   * @param entries - Directory entries
   * @param options - { public?: boolean, metadata?: Record } - if public true, store without encryption
   * @returns { cid, size }
   */
  async putDirectory(
    entries: DirEntry[],
    options?: { public?: boolean; metadata?: Record<string, unknown> }
  ): Promise<{ cid: CID; size: number }> {
    const size = entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
    if (options?.public) {
      const legacyEntries = entries.map(e => ({
        name: e.name,
        hash: e.cid.hash,
        size: e.size ?? 0,
      }));
      const hash = await create.putDirectory(this.config, legacyEntries, options.metadata);
      return { cid: { hash }, size };
    }
    // Encrypted by default
    const encryptedEntries: EncryptedDirEntry[] = entries.map(e => ({
      name: e.name,
      hash: e.cid.hash,
      size: e.size,
      key: e.cid.key,
      isTree: e.isTree,
    }));
    const result = await putDirectoryEncrypted(this.config, encryptedEntries, options?.metadata);
    return { cid: cid(result.hash, result.key), size };
  }

  // Read

  async getBlob(hash: Hash): Promise<Uint8Array | null> {
    return read.getBlob(this.store, hash);
  }

  /**
   * Get a tree node
   */
  async getTreeNode(id: CID): Promise<TreeNode | null> {
    if (id.key) {
      return getTreeNodeEncrypted(this.store, id.hash, id.key);
    }
    return read.getTreeNode(this.store, id.hash);
  }

  async isTree(id: CID): Promise<boolean> {
    return read.isTree(this.store, id.hash);
  }

  async isDirectory(id: CID): Promise<boolean> {
    return read.isDirectory(this.store, id.hash);
  }

  /**
   * Read a file
   */
  async readFile(id: CID): Promise<Uint8Array | null> {
    if (id.key) {
      return readFileEncrypted(this.store, id.hash, id.key);
    }
    return read.readFile(this.store, id.hash);
  }

  /**
   * Stream a file
   */
  async *readFileStream(id: CID): AsyncGenerator<Uint8Array> {
    if (id.key) {
      yield* readFileEncryptedStream(this.store, id.hash, id.key);
    } else {
      yield* read.readFileStream(this.store, id.hash);
    }
  }

  /**
   * List directory entries
   */
  async listDirectory(id: CID): Promise<TreeEntry[]> {
    if (id.key) {
      const entries = await listDirectoryEncrypted(this.store, id.hash, id.key);
      return entries.map(e => ({
        name: e.name,
        cid: cid(e.hash, e.key),
        size: e.size,
        isTree: e.isTree ?? false,
      }));
    }
    const entries = await read.listDirectory(this.store, id.hash);
    return entries.map(e => ({
      name: e.name,
      cid: { hash: e.hash },
      size: e.size,
      isTree: e.isTree,
    }));
  }

  /**
   * Resolve a path to get the entry's CID
   *
   * @param root - Root CID of the tree
   * @param path - Path to resolve (string like 'a/b/file.txt' or array like ['a', 'b', 'file.txt'])
   * @returns { cid, isTree } or null if not found
   */
  async resolvePath(
    root: CID,
    path: string | string[]
  ): Promise<{ cid: CID; isTree: boolean } | null> {
    const parts = Array.isArray(path)
      ? path
      : path.split('/').filter(p => p.length > 0);

    let current = root;
    let isTree = true;

    for (const segment of parts) {
      const entries = await this.listDirectory(current);
      const entry = entries.find(e => e.name === segment);
      if (!entry) {
        return null;
      }

      current = entry.cid;
      isTree = entry.isTree;
    }

    return { cid: current, isTree };
  }

  async getSize(hash: Hash): Promise<number> {
    return read.getSize(this.store, hash);
  }

  async *walk(
    hash: Hash,
    path: string = ''
  ): AsyncGenerator<{ path: string; hash: Hash; isTree: boolean; size?: number }> {
    yield* read.walk(this.store, hash, path);
  }

  // Edit operations

  /**
   * Add or update an entry in a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param name - Name of the entry
   * @param entry - CID of the entry content
   * @param size - Size of the content
   * @param isTree - Whether the entry is a directory
   * @returns New root CID
   */
  async setEntry(
    root: CID,
    path: string[],
    name: string,
    entry: CID,
    size: number,
    isTree = false
  ): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.setEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        name,
        entry.hash,
        size,
        entry.key,
        isTree
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.setEntry(this.config, root.hash, path, name, entry.hash, size, isTree);
    return { hash };
  }

  /**
   * Remove an entry from a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param name - Name of the entry to remove
   * @returns New root CID
   */
  async removeEntry(root: CID, path: string[], name: string): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.removeEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        name
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.removeEntry(this.config, root.hash, path, name);
    return { hash };
  }

  /**
   * Rename an entry in a directory
   * @param root - Root CID of the tree
   * @param path - Path to the directory containing the entry
   * @param oldName - Current name
   * @param newName - New name
   * @returns New root CID
   */
  async renameEntry(
    root: CID,
    path: string[],
    oldName: string,
    newName: string
  ): Promise<CID> {
    if (root.key) {
      const result = await editEncrypted.renameEntryEncrypted(
        this.config,
        root.hash,
        root.key,
        path,
        oldName,
        newName
      );
      return cid(result.hash, result.key);
    }
    const hash = await edit.renameEntry(this.config, root.hash, path, oldName, newName);
    return { hash };
  }

  /**
   * Move an entry to a different directory (public trees only)
   * @param root - Root CID of the tree
   * @param sourcePath - Path to the source directory
   * @param name - Name of the entry to move
   * @param targetPath - Path to the target directory
   * @returns New root CID
   */
  async moveEntry(
    root: CID,
    sourcePath: string[],
    name: string,
    targetPath: string[]
  ): Promise<CID> {
    if (root.key) {
      throw new Error('moveEntry not yet implemented for encrypted trees');
    }
    const hash = await edit.moveEntry(this.config, root.hash, sourcePath, name, targetPath);
    return { hash };
  }

  // Utility

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
