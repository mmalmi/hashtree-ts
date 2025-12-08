/**
 * OPFS (Origin Private File System) content-addressed store
 * Persistent browser storage using the File System Access API
 *
 * Files are stored as: <dirName>/<first2chars>/<hash>.bin
 * This provides sharding to avoid too many files in one directory.
 */

import { Store, Hash, toHex, fromHex } from '../types.js';

const DEFAULT_DIR_NAME = 'hashtree';

export interface OpfsStoreOptions {
  /** Directory name in OPFS root (default: 'hashtree') */
  dirName?: string;
}

export class OpfsStore implements Store {
  private dirName: string;
  private rootDir: FileSystemDirectoryHandle | null = null;
  private storeDir: FileSystemDirectoryHandle | null = null;

  constructor(options: OpfsStoreOptions | string = DEFAULT_DIR_NAME) {
    if (typeof options === 'string') {
      this.dirName = options;
    } else {
      this.dirName = options.dirName ?? DEFAULT_DIR_NAME;
    }
  }

  /**
   * Get or create the store directory
   */
  private async getStoreDir(): Promise<FileSystemDirectoryHandle> {
    if (this.storeDir) return this.storeDir;

    this.rootDir = await navigator.storage.getDirectory();
    this.storeDir = await this.rootDir.getDirectoryHandle(this.dirName, { create: true });
    return this.storeDir;
  }

  /**
   * Get shard directory for a hash (first 2 hex chars)
   */
  private async getShardDir(hashHex: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    const storeDir = await this.getStoreDir();
    const shard = hashHex.slice(0, 2);

    try {
      return await storeDir.getDirectoryHandle(shard, { create });
    } catch {
      return null;
    }
  }

  /**
   * Get file handle for a hash
   */
  private async getFileHandle(hash: Hash, create: boolean): Promise<FileSystemFileHandle | null> {
    const hashHex = toHex(hash);
    const shardDir = await this.getShardDir(hashHex, create);
    if (!shardDir) return null;

    try {
      return await shardDir.getFileHandle(`${hashHex}.bin`, { create });
    } catch {
      return null;
    }
  }

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    const hashHex = toHex(hash);

    // Check if already exists
    const existingHandle = await this.getFileHandle(hash, false);
    if (existingHandle) {
      return false;
    }

    // Create and write
    const handle = await this.getFileHandle(hash, true);
    if (!handle) {
      throw new Error(`Failed to create file for hash ${hashHex}`);
    }

    const writable = await handle.createWritable();
    await writable.write(data as unknown as ArrayBuffer);
    await writable.close();

    return true;
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    if (!hash) return null;

    const handle = await this.getFileHandle(hash, false);
    if (!handle) return null;

    try {
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async has(hash: Hash): Promise<boolean> {
    const handle = await this.getFileHandle(hash, false);
    return handle !== null;
  }

  async delete(hash: Hash): Promise<boolean> {
    const hashHex = toHex(hash);
    const shardDir = await this.getShardDir(hashHex, false);
    if (!shardDir) return false;

    try {
      await shardDir.removeEntry(`${hashHex}.bin`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all stored hashes
   */
  async keys(): Promise<Hash[]> {
    const storeDir = await this.getStoreDir();
    const hashes: Hash[] = [];

    // Iterate over shard directories
    // @ts-ignore - entries() exists on FileSystemDirectoryHandle
    for await (const [shardName, shardHandle] of storeDir.entries()) {
      if (shardHandle.kind !== 'directory') continue;

      // Iterate over files in shard
      // @ts-ignore
      for await (const [fileName] of shardHandle.entries()) {
        if (fileName.endsWith('.bin')) {
          const hashHex = fileName.slice(0, -4); // Remove .bin
          hashes.push(fromHex(hashHex));
        }
      }
    }

    return hashes;
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    const storeDir = await this.getStoreDir();

    // Remove all shard directories
    // @ts-ignore
    for await (const [name, handle] of storeDir.entries()) {
      if (handle.kind === 'directory') {
        await storeDir.removeEntry(name, { recursive: true });
      }
    }
  }

  /**
   * Get count of stored items
   */
  async count(): Promise<number> {
    const keys = await this.keys();
    return keys.length;
  }

  /**
   * Get total bytes stored
   */
  async totalBytes(): Promise<number> {
    const storeDir = await this.getStoreDir();
    let total = 0;

    // @ts-ignore
    for await (const [, shardHandle] of storeDir.entries()) {
      if (shardHandle.kind !== 'directory') continue;

      // @ts-ignore
      for await (const [, fileHandle] of shardHandle.entries()) {
        if (fileHandle.kind === 'file') {
          const file = await fileHandle.getFile();
          total += file.size;
        }
      }
    }

    return total;
  }

  /**
   * Flush - no-op for OPFS since writes are synchronous to disk
   */
  async flush(): Promise<void> {
    // OPFS writes are already persisted
  }

  /**
   * Close - cleanup any resources
   */
  async close(): Promise<void> {
    this.rootDir = null;
    this.storeDir = null;
  }

  /**
   * Delete the entire store directory
   */
  static async deleteStore(dirName: string = DEFAULT_DIR_NAME): Promise<void> {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(dirName, { recursive: true });
    } catch {
      // Directory might not exist
    }
  }
}
