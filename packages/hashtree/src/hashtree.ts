/**
 * HashTree - Unified merkle tree operations
 *
 * Single class for creating, reading, and editing content-addressed merkle trees.
 */

import { Store, Hash, TreeNode, toHex } from './types.js';
import { decodeTreeNode, isTreeNode } from './codec.js';
import { type EncryptionKey } from './crypto.js';
import * as create from './tree/create.js';
import * as read from './tree/read.js';
import * as edit from './tree/edit.js';
import {
  putFileEncrypted as putEncrypted,
  readFileEncrypted as readEncrypted,
  readFileEncryptedStream as readEncryptedStream,
} from './encrypted.js';

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

  private get config(): create.CreateConfig {
    return { store: this.store, chunkSize: this.chunkSize, maxLinks: this.maxLinks };
  }

  // Create

  async putBlob(data: Uint8Array): Promise<Hash> {
    return create.putBlob(this.store, data);
  }

  async putFile(data: Uint8Array): Promise<{ hash: Hash; size: number }> {
    return create.putFile(this.config, data);
  }

  async putDirectory(entries: DirEntry[], metadata?: Record<string, unknown>): Promise<Hash> {
    return create.putDirectory(this.config, entries, metadata);
  }

  // Read

  async getBlob(hash: Hash): Promise<Uint8Array | null> {
    return read.getBlob(this.store, hash);
  }

  async getTreeNode(hash: Hash): Promise<TreeNode | null> {
    return read.getTreeNode(this.store, hash);
  }

  async isTree(hash: Hash): Promise<boolean> {
    return read.isTree(this.store, hash);
  }

  async isDirectory(hash: Hash): Promise<boolean> {
    return read.isDirectory(this.store, hash);
  }

  async readFile(hash: Hash): Promise<Uint8Array | null> {
    return read.readFile(this.store, hash);
  }

  async *readFileStream(hash: Hash): AsyncGenerator<Uint8Array> {
    yield* read.readFileStream(this.store, hash);
  }

  async listDirectory(hash: Hash): Promise<TreeEntry[]> {
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

  // Edit

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

  async removeEntry(rootHash: Hash, path: string[], name: string): Promise<Hash> {
    return edit.removeEntry(this.config, rootHash, path, name);
  }

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

  // Encrypted (CHK - Content Hash Key) - EXPERIMENTAL
  // Key is derived from content, ensuring deterministic encryption
  // Same content → same ciphertext → deduplication works

  async putFileEncrypted(
    data: Uint8Array
  ): Promise<{ hash: Hash; size: number; key: EncryptionKey }> {
    return putEncrypted(this.config, data);
  }

  async readFileEncrypted(hash: Hash, key: EncryptionKey): Promise<Uint8Array | null> {
    return readEncrypted(this.store, hash, key);
  }

  async *readFileEncryptedStream(hash: Hash, key: EncryptionKey): AsyncGenerator<Uint8Array> {
    yield* readEncryptedStream(this.store, hash, key);
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
