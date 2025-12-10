/**
 * Dexie-based IndexedDB store for hashtree blobs
 * More robust than raw IndexedDB - handles errors, upgrades, and stuck connections better
 */
import Dexie, { type Table } from 'dexie';
import type { Store, Hash } from 'hashtree';
import { toHex, fromHex } from 'hashtree';

interface BlobEntry {
  hashHex: string;
  data: Uint8Array;
}

class HashTreeDB extends Dexie {
  blobs!: Table<BlobEntry, string>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({
      blobs: '&hashHex',
    });
  }
}

/**
 * Dexie-based Store implementation
 * Drop-in replacement for IndexedDBStore with better error handling
 */
export class DexieStore implements Store {
  private db: HashTreeDB;

  constructor(dbName: string = 'hashtree') {
    this.db = new HashTreeDB(dbName);
  }

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    const hashHex = toHex(hash);
    try {
      await this.db.blobs.put({ hashHex, data: new Uint8Array(data) });
      return true;
    } catch (e) {
      console.error('[DexieStore] put error:', e);
      return false;
    }
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    if (!hash) return null;
    const hashHex = toHex(hash);
    try {
      const entry = await this.db.blobs.get(hashHex);
      return entry ? new Uint8Array(entry.data) : null;
    } catch (e) {
      console.error('[DexieStore] get error:', e);
      return null;
    }
  }

  async has(hash: Hash): Promise<boolean> {
    const hashHex = toHex(hash);
    try {
      const entry = await this.db.blobs.get(hashHex);
      return entry !== undefined;
    } catch (e) {
      console.error('[DexieStore] has error:', e);
      return false;
    }
  }

  async delete(hash: Hash): Promise<boolean> {
    const hashHex = toHex(hash);
    try {
      const existed = await this.has(hash);
      if (existed) {
        await this.db.blobs.delete(hashHex);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[DexieStore] delete error:', e);
      return false;
    }
  }

  /**
   * Get all stored hashes
   */
  async keys(): Promise<Hash[]> {
    try {
      const entries = await this.db.blobs.toArray();
      return entries.map(e => fromHex(e.hashHex));
    } catch (e) {
      console.error('[DexieStore] keys error:', e);
      return [];
    }
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    try {
      await this.db.blobs.clear();
    } catch (e) {
      console.error('[DexieStore] clear error:', e);
    }
  }

  /**
   * Get count of stored items
   */
  async count(): Promise<number> {
    try {
      return await this.db.blobs.count();
    } catch (e) {
      console.error('[DexieStore] count error:', e);
      return 0;
    }
  }

  /**
   * Get total bytes stored
   */
  async totalBytes(): Promise<number> {
    try {
      const entries = await this.db.blobs.toArray();
      return entries.reduce((sum, e) => sum + e.data.length, 0);
    } catch (e) {
      console.error('[DexieStore] totalBytes error:', e);
      return 0;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Delete the entire database
   */
  static async deleteDatabase(dbName: string = 'hashtree'): Promise<void> {
    await Dexie.delete(dbName);
  }
}
