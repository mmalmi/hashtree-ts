/**
 * IndexedDB content-addressed store
 * Persistent browser storage with automatic write batching
 */

import { Store, Hash, toHex, fromHex } from '../types.js';

const DB_NAME = 'hashtree';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

/** Default batch size before auto-flush */
const DEFAULT_BATCH_SIZE = 100;
/** Default max time to wait before flushing (ms) */
const DEFAULT_FLUSH_DELAY = 10;

export interface IndexedDBStoreOptions {
  /** Database name (default: 'hashtree') */
  dbName?: string;
  /** Number of writes to batch before flushing (default: 100) */
  batchSize?: number;
  /** Max delay before flushing pending writes in ms (default: 10) */
  flushDelay?: number;
}

export class IndexedDBStore implements Store {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private batchSize: number;
  private flushDelay: number;

  // Write buffer
  private pendingWrites: Map<string, Uint8Array> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;

  constructor(options: IndexedDBStoreOptions | string = DB_NAME) {
    if (typeof options === 'string') {
      this.dbName = options;
      this.batchSize = DEFAULT_BATCH_SIZE;
      this.flushDelay = DEFAULT_FLUSH_DELAY;
    } else {
      this.dbName = options.dbName ?? DB_NAME;
      this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      this.flushDelay = options.flushDelay ?? DEFAULT_FLUSH_DELAY;
    }
  }

  /**
   * Open or create the database
   */
  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
    });
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
   * Flush all pending writes to IndexedDB in a single transaction
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
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();

      // Write all items in single transaction
      for (const [key, data] of writes) {
        store.put(data, key);
      }
    });
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    const key = toHex(hash);

    // Check pending writes first
    const pending = this.pendingWrites.get(key);
    if (pending) {
      return new Uint8Array(pending);
    }

    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const data = request.result;
        resolve(data ? new Uint8Array(data) : null);
      };
    });
  }

  async has(hash: Hash): Promise<boolean> {
    const key = toHex(hash);

    // Check pending writes first
    if (this.pendingWrites.has(key)) {
      return true;
    }

    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getKey(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result !== undefined);
    });
  }

  async delete(hash: Hash): Promise<boolean> {
    const db = await this.open();
    const key = toHex(hash);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Check if exists first
      const getRequest = store.getKey(key);
      getRequest.onsuccess = () => {
        if (getRequest.result === undefined) {
          resolve(false);
          return;
        }

        const deleteRequest = store.delete(key);
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => resolve(true);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get all stored hashes
   */
  async keys(): Promise<Hash[]> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = request.result as string[];
        resolve(keys.map(fromHex));
      };
    });
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get count of stored items
   */
  async count(): Promise<number> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get total bytes stored
   */
  async totalBytes(): Promise<number> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      let total = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          total += (cursor.value as Uint8Array).length;
          cursor.continue();
        } else {
          resolve(total);
        }
      };
    });
  }

  /**
   * Close the database connection
   * Flushes any pending writes first
   */
  async close(): Promise<void> {
    await this.flush();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Delete the entire database
   */
  static async deleteDatabase(dbName: string = DB_NAME): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
