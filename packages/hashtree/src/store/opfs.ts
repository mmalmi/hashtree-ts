/**
 * OPFS (Origin Private File System) content-addressed store
 * Persistent browser storage using the File System Access API
 *
 * Files are stored as: <dirName>/<first2chars>/<hash>.bin
 * This provides sharding to avoid too many files in one directory.
 *
 * Write batching: Like IndexedDBStore, writes are buffered in memory
 * and flushed periodically to avoid expensive per-write file operations.
 */

import { Store, Hash, toHex, fromHex } from '../types.js';

const DEFAULT_DIR_NAME = 'hashtree';

/** Default batch size before auto-flush */
const DEFAULT_BATCH_SIZE = 100;
/** Default max time to wait before flushing (ms) */
const DEFAULT_FLUSH_DELAY = 10;

export interface OpfsStoreOptions {
  /** Directory name in OPFS root (default: 'hashtree') */
  dirName?: string;
  /** Number of writes to batch before flushing (default: 100) */
  batchSize?: number;
  /** Max delay before flushing pending writes in ms (default: 10) */
  flushDelay?: number;
}

export class OpfsStore implements Store {
  private dirName: string;
  private rootDir: FileSystemDirectoryHandle | null = null;
  private storeDir: FileSystemDirectoryHandle | null = null;
  private batchSize: number;
  private flushDelay: number;

  // Write buffer (same pattern as IndexedDBStore)
  private pendingWrites: Map<string, Uint8Array> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;

  constructor(options: OpfsStoreOptions | string = DEFAULT_DIR_NAME) {
    if (typeof options === 'string') {
      this.dirName = options;
      this.batchSize = DEFAULT_BATCH_SIZE;
      this.flushDelay = DEFAULT_FLUSH_DELAY;
    } else {
      this.dirName = options.dirName ?? DEFAULT_DIR_NAME;
      this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      this.flushDelay = options.flushDelay ?? DEFAULT_FLUSH_DELAY;
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
    const key = toHex(hash);

    // Check if already in pending writes
    if (this.pendingWrites.has(key)) {
      return false;
    }

    // Add to pending writes
    this.pendingWrites.set(key, new Uint8Array(data));

    // Schedule flush if needed
    if (this.pendingWrites.size >= this.batchSize) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushDelay);
    }

    return true;
  }

  /**
   * Flush all pending writes to OPFS
   */
  async flush(): Promise<void> {
    // If already flushing, wait for it
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    // Clear timer if set
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Nothing to flush
    if (this.pendingWrites.size === 0) {
      return;
    }

    // Take ownership of pending writes
    const writes = this.pendingWrites;
    this.pendingWrites = new Map();

    this.flushPromise = this.doFlush(writes);
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async doFlush(writes: Map<string, Uint8Array>): Promise<void> {
    // Group writes by shard for efficiency
    const shardWrites = new Map<string, Map<string, Uint8Array>>();

    for (const [hashHex, data] of writes) {
      const shard = hashHex.slice(0, 2);
      if (!shardWrites.has(shard)) {
        shardWrites.set(shard, new Map());
      }
      shardWrites.get(shard)!.set(hashHex, data);
    }

    // Write all files (still need individual file ops, but at least we batch the directory lookups)
    const writePromises: Promise<void>[] = [];

    for (const [shard, shardData] of shardWrites) {
      const shardDir = await this.getShardDir(shard, true);
      if (!shardDir) continue;

      for (const [hashHex, data] of shardData) {
        writePromises.push(this.writeFile(shardDir, hashHex, data));
      }
    }

    await Promise.all(writePromises);
  }

  private async writeFile(shardDir: FileSystemDirectoryHandle, hashHex: string, data: Uint8Array): Promise<void> {
    try {
      // Check if file already exists
      try {
        await shardDir.getFileHandle(`${hashHex}.bin`, { create: false });
        return; // Already exists
      } catch {
        // File doesn't exist, continue to create
      }

      const handle = await shardDir.getFileHandle(`${hashHex}.bin`, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data as unknown as ArrayBuffer);
      await writable.close();
    } catch (err) {
      console.error(`Failed to write file ${hashHex}:`, err);
    }
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    if (!hash) return null;

    const key = toHex(hash);

    // Check pending writes first (same as IndexedDBStore)
    const pending = this.pendingWrites.get(key);
    if (pending) {
      return new Uint8Array(pending);
    }

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
    const key = toHex(hash);

    // Check pending writes first
    if (this.pendingWrites.has(key)) {
      return true;
    }

    const handle = await this.getFileHandle(hash, false);
    return handle !== null;
  }

  async delete(hash: Hash): Promise<boolean> {
    const hashHex = toHex(hash);

    // Remove from pending if present
    if (this.pendingWrites.has(hashHex)) {
      this.pendingWrites.delete(hashHex);
      return true;
    }

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
    // Flush pending writes first so we get accurate count
    await this.flush();

    const storeDir = await this.getStoreDir();
    const hashes: Hash[] = [];

    // Iterate over shard directories
    // @ts-ignore - entries() exists on FileSystemDirectoryHandle
    for await (const [, shardHandle] of storeDir.entries()) {
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
    // Clear pending writes
    this.pendingWrites.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

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
    // Flush first for accurate count
    await this.flush();

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
   * Close - cleanup any resources
   * Flushes any pending writes first
   */
  async close(): Promise<void> {
    await this.flush();
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
