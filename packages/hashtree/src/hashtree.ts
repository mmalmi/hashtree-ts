/**
 * HashTree - Unified merkle tree operations
 *
 * Single class for creating, reading, and editing content-addressed merkle trees.
 *
 * All files are encrypted by default using CHK (Content Hash Key) encryption.
 * Use the "Public" variants (putFilePublic, readFilePublic) for unencrypted storage.
 */

import { Store, Hash, TreeNode, toHex } from './types.js';
import { decodeTreeNode, isTreeNode } from './codec.js';
import { type EncryptionKey } from './crypto.js';
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
  hash: Hash;
  size?: number;
  isTree: boolean;
  /** CHK key for encrypted entries */
  key?: EncryptionKey;
}

export interface DirEntry {
  name: string;
  hash: Hash;
  size?: number;
  /** CHK key for encrypted entries */
  key?: EncryptionKey;
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
   * @returns { hash, size, key? } - key is only returned for encrypted files
   */
  async putFile(
    data: Uint8Array,
    options?: { public?: boolean }
  ): Promise<{ hash: Hash; size: number; key?: EncryptionKey }> {
    if (options?.public) {
      return create.putFile(this.config, data);
    }
    return putFileEncrypted(this.config, data);
  }

  /**
   * Store a directory
   * @param entries - Directory entries (with keys for encrypted children)
   * @param options - { public?: boolean, metadata?: Record } - if public true, store without encryption
   * @returns { hash, size, key? } - key is only returned for encrypted directories
   */
  async putDirectory(
    entries: DirEntry[],
    options?: { public?: boolean; metadata?: Record<string, unknown> }
  ): Promise<{ hash: Hash; size: number; key?: EncryptionKey }> {
    if (options?.public) {
      const hash = await create.putDirectory(this.config, entries, options.metadata);
      const size = entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
      return { hash, size };
    }
    // Encrypted by default
    const encryptedEntries: EncryptedDirEntry[] = entries.map(e => ({
      name: e.name,
      hash: e.hash,
      size: e.size,
      key: e.key,
    }));
    return putDirectoryEncrypted(this.config, encryptedEntries, options?.metadata);
  }

  // Read

  async getBlob(hash: Hash): Promise<Uint8Array | null> {
    return read.getBlob(this.store, hash);
  }

  /**
   * Get a tree node
   * @param hash - Hash of the tree node
   * @param key - Decryption key (required for encrypted nodes, omit for public)
   */
  async getTreeNode(hash: Hash, key?: EncryptionKey): Promise<TreeNode | null> {
    if (key) {
      return getTreeNodeEncrypted(this.store, hash, key);
    }
    return read.getTreeNode(this.store, hash);
  }

  async isTree(hash: Hash): Promise<boolean> {
    return read.isTree(this.store, hash);
  }

  async isDirectory(hash: Hash): Promise<boolean> {
    return read.isDirectory(this.store, hash);
  }

  /**
   * Read a file
   * @param hash - Hash of the file
   * @param key - Decryption key (required for encrypted files, omit for public files)
   */
  async readFile(hash: Hash, key?: EncryptionKey): Promise<Uint8Array | null> {
    if (key) {
      return readFileEncrypted(this.store, hash, key);
    }
    return read.readFile(this.store, hash);
  }

  /**
   * Stream a file
   * @param hash - Hash of the file
   * @param key - Decryption key (required for encrypted files, omit for public files)
   */
  async *readFileStream(hash: Hash, key?: EncryptionKey): AsyncGenerator<Uint8Array> {
    if (key) {
      yield* readFileEncryptedStream(this.store, hash, key);
    } else {
      yield* read.readFileStream(this.store, hash);
    }
  }

  /**
   * List directory entries
   * @param hash - Hash of the directory
   * @param key - Decryption key (required for encrypted directories, omit for public)
   * @returns Directory entries with their encryption keys
   */
  async listDirectory(hash: Hash, key?: EncryptionKey): Promise<TreeEntry[]> {
    if (key) {
      const entries = await listDirectoryEncrypted(this.store, hash, key);
      return entries.map(e => ({
        name: e.name,
        hash: e.hash,
        size: e.size,
        isTree: e.isTree ?? false,
        key: e.key,
      }));
    }
    return read.listDirectory(this.store, hash);
  }

  async resolvePath(rootHash: Hash, path: string): Promise<Hash | null> {
    return read.resolvePath(this.store, rootHash, path);
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

  // Edit (public/unencrypted trees)

  /**
   * Add or update an entry in a directory (public trees)
   * For encrypted trees, use setEntryEncrypted
   */
  async setEntry(
    rootHash: Hash,
    path: string[],
    name: string,
    hash: Hash,
    size: number,
    isTree = false
  ): Promise<Hash> {
    return edit.setEntry(this.config, rootHash, path, name, hash, size, isTree);
  }

  /**
   * Remove an entry from a directory (public trees)
   * For encrypted trees, use removeEntryEncrypted
   */
  async removeEntry(rootHash: Hash, path: string[], name: string): Promise<Hash> {
    return edit.removeEntry(this.config, rootHash, path, name);
  }

  /**
   * Rename an entry (public trees)
   * For encrypted trees, use renameEntryEncrypted
   */
  async renameEntry(
    rootHash: Hash,
    path: string[],
    oldName: string,
    newName: string
  ): Promise<Hash> {
    return edit.renameEntry(this.config, rootHash, path, oldName, newName);
  }

  async moveEntry(
    rootHash: Hash,
    sourcePath: string[],
    name: string,
    targetPath: string[]
  ): Promise<Hash> {
    return edit.moveEntry(this.config, rootHash, sourcePath, name, targetPath);
  }

  // Edit (encrypted trees)

  /**
   * Add or update an entry in an encrypted directory
   * @param rootHash - Current root hash
   * @param rootKey - Current root decryption key
   * @param path - Path to the directory
   * @param name - Name of the entry
   * @param hash - Hash of the entry content
   * @param size - Size of the content
   * @param key - Encryption key of the entry (for encrypted content)
   * @param isTree - Whether the entry is a directory
   * @returns New root hash and key
   */
  async setEntryEncrypted(
    rootHash: Hash,
    rootKey: EncryptionKey,
    path: string[],
    name: string,
    hash: Hash,
    size: number,
    key?: EncryptionKey,
    isTree = false
  ): Promise<{ hash: Hash; key: EncryptionKey }> {
    return editEncrypted.setEntryEncrypted(
      this.config,
      rootHash,
      rootKey,
      path,
      name,
      hash,
      size,
      key,
      isTree
    );
  }

  /**
   * Remove an entry from an encrypted directory
   * @param rootHash - Current root hash
   * @param rootKey - Current root decryption key
   * @param path - Path to the directory
   * @param name - Name of the entry to remove
   * @returns New root hash and key
   */
  async removeEntryEncrypted(
    rootHash: Hash,
    rootKey: EncryptionKey,
    path: string[],
    name: string
  ): Promise<{ hash: Hash; key: EncryptionKey }> {
    return editEncrypted.removeEntryEncrypted(
      this.config,
      rootHash,
      rootKey,
      path,
      name
    );
  }

  /**
   * Rename an entry in an encrypted directory
   * @param rootHash - Current root hash
   * @param rootKey - Current root decryption key
   * @param path - Path to the directory
   * @param oldName - Current name
   * @param newName - New name
   * @returns New root hash and key
   */
  async renameEntryEncrypted(
    rootHash: Hash,
    rootKey: EncryptionKey,
    path: string[],
    oldName: string,
    newName: string
  ): Promise<{ hash: Hash; key: EncryptionKey }> {
    return editEncrypted.renameEntryEncrypted(
      this.config,
      rootHash,
      rootKey,
      path,
      oldName,
      newName
    );
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
