/**
 * Chunk metadata store for tracking ownership and enabling quota-based cleanup
 *
 * Tracks which trees own which chunks, enabling:
 * - Storage quota enforcement per user
 * - LRU-based cleanup within quotas
 * - Shared chunk detection (don't delete if multiple owners)
 */
import Dexie, { type Table } from 'dexie';

/**
 * Metadata for a single chunk (blob)
 */
export interface ChunkMeta {
  /** SHA256 hash in hex - primary key */
  hashHex: string;
  /** Size in bytes */
  size: number;
  /** Tree keys that own this chunk: ["npub/treeName", ...] */
  owners: string[];
  /** Last access timestamp for LRU */
  lastAccessed: number;
}

/**
 * Sync state for a tree
 */
export interface TreeSyncState {
  /** "npub/treeName" - primary key */
  key: string;
  /** Owner's npub for quota grouping */
  ownerNpub: string;
  /** Current synced root hash (hex) */
  rootHash: string;
  /** Total bytes for this tree */
  totalBytes: number;
  /** Last sync timestamp */
  lastSynced: number;
  /** Whether this is user's own tree (any of their accounts) */
  isOwn: boolean;
}

class ChunkMetadataDB extends Dexie {
  chunks!: Table<ChunkMeta, string>;
  trees!: Table<TreeSyncState, string>;

  constructor() {
    super('hashtree-chunk-metadata');
    this.version(1).stores({
      // chunks: hashHex is primary key, index by owners for cleanup queries
      chunks: '&hashHex, *owners, lastAccessed',
      // trees: key is primary key, index by ownerNpub for quota calculation
      trees: '&key, ownerNpub, isOwn',
    });
  }
}

const db = new ChunkMetadataDB();

/**
 * Register chunks as belonging to a tree
 * Updates lastAccessed and adds tree to owners list
 */
export async function registerChunks(
  treeKey: string,
  chunks: Array<{ hashHex: string; size: number }>
): Promise<void> {
  const now = Date.now();

  await db.transaction('rw', db.chunks, async () => {
    for (const { hashHex, size } of chunks) {
      const existing = await db.chunks.get(hashHex);
      if (existing) {
        // Add tree to owners if not already present
        if (!existing.owners.includes(treeKey)) {
          existing.owners.push(treeKey);
        }
        existing.lastAccessed = now;
        await db.chunks.put(existing);
      } else {
        // New chunk
        await db.chunks.put({
          hashHex,
          size,
          owners: [treeKey],
          lastAccessed: now,
        });
      }
    }
  });
}

/**
 * Update last accessed time for chunks (call when reading data)
 */
export async function touchChunks(hashHexes: string[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.chunks, async () => {
    for (const hashHex of hashHexes) {
      await db.chunks.where('hashHex').equals(hashHex).modify({ lastAccessed: now });
    }
  });
}

/**
 * Get or create tree sync state
 */
export async function getTreeSyncState(key: string): Promise<TreeSyncState | undefined> {
  return db.trees.get(key);
}

/**
 * Update tree sync state
 */
export async function updateTreeSyncState(state: TreeSyncState): Promise<void> {
  await db.trees.put(state);
}

/**
 * Remove tree sync state and unregister its chunks
 */
export async function removeTreeSyncState(key: string): Promise<void> {
  await db.transaction('rw', [db.trees, db.chunks], async () => {
    await db.trees.delete(key);
    // Remove tree from chunk owners
    await db.chunks.where('owners').equals(key).modify((chunk) => {
      chunk.owners = chunk.owners.filter(o => o !== key);
    });
  });
}

/**
 * Get total storage used by a specific user (npub)
 */
export async function getStorageByUser(npub: string): Promise<number> {
  const trees = await db.trees.where('ownerNpub').equals(npub).toArray();
  return trees.reduce((sum, t) => sum + t.totalBytes, 0);
}

/**
 * Get all users (npubs) with synced trees, excluding own accounts
 */
export async function getOtherUsersWithTrees(ownNpubs: string[]): Promise<string[]> {
  const trees = await db.trees.where('isOwn').equals(0).toArray();
  const npubs = new Set(trees.map(t => t.ownerNpub));
  // Filter out own accounts
  for (const npub of ownNpubs) {
    npubs.delete(npub);
  }
  return Array.from(npubs);
}

/**
 * Get total tracked storage (sum of all chunk sizes)
 */
export async function getTotalTrackedBytes(): Promise<number> {
  const chunks = await db.chunks.toArray();
  return chunks.reduce((sum, c) => sum + c.size, 0);
}

/**
 * Get chunks to evict for a user to reach target size
 * Returns chunks in LRU order (least recently accessed first)
 * Only returns chunks that are ONLY owned by this user's trees
 */
export async function getChunksToEvict(
  npub: string,
  targetBytesToFree: number
): Promise<string[]> {
  // Get all trees for this user
  const userTrees = await db.trees.where('ownerNpub').equals(npub).toArray();
  const userTreeKeys = new Set(userTrees.map(t => t.key));

  // Get all chunks owned by these trees, sorted by lastAccessed
  const chunks = await db.chunks
    .orderBy('lastAccessed')
    .toArray();

  const toEvict: string[] = [];
  let freedBytes = 0;

  for (const chunk of chunks) {
    if (freedBytes >= targetBytesToFree) break;

    // Check if this chunk is ONLY owned by user's trees
    const onlyOwnedByUser = chunk.owners.every(owner => userTreeKeys.has(owner));
    if (onlyOwnedByUser && chunk.owners.length > 0) {
      toEvict.push(chunk.hashHex);
      freedBytes += chunk.size;
    }
  }

  return toEvict;
}

/**
 * Remove chunks from metadata (call after deleting from IndexedDB)
 */
export async function removeChunks(hashHexes: string[]): Promise<void> {
  await db.chunks.bulkDelete(hashHexes);
}

/**
 * Get orphaned chunks (chunks with no owners)
 */
export async function getOrphanedChunks(): Promise<string[]> {
  const chunks = await db.chunks.toArray();
  return chunks
    .filter(c => c.owners.length === 0)
    .map(c => c.hashHex);
}

/**
 * Clear all metadata (for testing/reset)
 */
export async function clearAllMetadata(): Promise<void> {
  await db.chunks.clear();
  await db.trees.clear();
}

/**
 * Storage stats for a user
 */
export interface UserStorageStats {
  npub: string;
  bytes: number;
  treeCount: number;
  isOwn: boolean;
}

/**
 * Get storage breakdown by user (for settings page display)
 */
export async function getStorageBreakdown(): Promise<UserStorageStats[]> {
  const trees = await db.trees.toArray();

  // Group by npub
  const byUser = new Map<string, { bytes: number; treeCount: number; isOwn: boolean }>();

  for (const tree of trees) {
    const existing = byUser.get(tree.ownerNpub);
    if (existing) {
      existing.bytes += tree.totalBytes;
      existing.treeCount += 1;
      // If any tree is own, mark user as own
      if (tree.isOwn) existing.isOwn = true;
    } else {
      byUser.set(tree.ownerNpub, {
        bytes: tree.totalBytes,
        treeCount: 1,
        isOwn: tree.isOwn,
      });
    }
  }

  // Convert to array and sort by bytes (descending)
  return Array.from(byUser.entries())
    .map(([npub, stats]) => ({ npub, ...stats }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Get synced trees list (for settings page display)
 */
export async function getSyncedTrees(): Promise<TreeSyncState[]> {
  return db.trees.orderBy('lastSynced').reverse().toArray();
}

// Export database for testing
export { db as chunkMetadataDb };
