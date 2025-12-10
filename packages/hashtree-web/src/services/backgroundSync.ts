/**
 * Background sync service for automatically syncing trees to IndexedDB
 *
 * Syncs:
 * - User's own trees (for cross-device sync)
 * - Followed users' public trees
 * - Visited unlisted trees
 *
 * Implements quota-based storage management:
 * - 50% reserved for user's own trees (never auto-deleted)
 * - 50% split equally among other users (followed + visited unlisted owners)
 * - Enforced only when total storage exceeds cap
 */
import { get } from 'svelte/store';
import type { CID, RefResolverListEntry } from 'hashtree';
import { toHex } from 'hashtree';
import { getRefResolver } from '../refResolver';
import { createFollowsStore, type Follows } from '../stores/follows';
import { settingsStore, type SyncSettings, DEFAULT_SYNC_SETTINGS } from '../stores/settings';
import { accountsStore } from '../accounts';
import { nostrStore, pubkeyToNpub } from '../nostr';
import { idbStore, getTree } from '../store';
import {
  updateTreeSyncState,
  getTreeSyncState,
  getStorageByUser,
  getOtherUsersWithTrees,
  getChunksToEvict,
  removeChunks,
  type TreeSyncState,
} from '../stores/chunkMetadata';

interface SyncTask {
  key: string;        // "npub/treeName"
  cid: CID;
  isOwn: boolean;
  priority: number;   // Lower = higher priority (own=0, visited=1, followed=2)
}

/**
 * Background sync service
 */
export class BackgroundSyncService {
  private running = false;
  private syncQueue: SyncTask[] = [];
  private processing = false;
  private followsUnsubscribers: Map<string, () => void> = new Map();
  private treeListUnsubscribers: Map<string, () => void> = new Map();
  private ownTreesUnsubscriber: (() => void) | null = null;
  private processQueueTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Start the background sync service
   * Called after login
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('[backgroundSync] Starting service');

    // Subscribe to own trees first (for cross-device sync)
    this.subscribeToOwnTrees();

    // Subscribe to followed users' trees
    this.subscribeToFollows();
  }

  /**
   * Stop the background sync service
   * Called on logout
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    console.log('[backgroundSync] Stopping service');

    // Cleanup subscriptions
    this.ownTreesUnsubscriber?.();
    this.ownTreesUnsubscriber = null;

    for (const unsub of this.followsUnsubscribers.values()) {
      unsub();
    }
    this.followsUnsubscribers.clear();

    for (const unsub of this.treeListUnsubscribers.values()) {
      unsub();
    }
    this.treeListUnsubscribers.clear();

    // Clear queue
    this.syncQueue = [];
    if (this.processQueueTimeoutId) {
      clearTimeout(this.processQueueTimeoutId);
      this.processQueueTimeoutId = null;
    }
  }

  /**
   * Queue a tree for sync
   */
  queueTreeSync(key: string, cid: CID, isOwn: boolean, priority: number = 2): void {
    const settings = this.getSyncSettings();
    if (!settings.enabled) return;

    // Check if already in queue
    const existingIndex = this.syncQueue.findIndex(t => t.key === key);
    if (existingIndex !== -1) {
      // Update if new CID is different
      if (toHex(this.syncQueue[existingIndex].cid.hash) !== toHex(cid.hash)) {
        this.syncQueue[existingIndex] = { key, cid, isOwn, priority };
      }
      return;
    }

    this.syncQueue.push({ key, cid, isOwn, priority });

    // Sort by priority (lower = higher priority)
    this.syncQueue.sort((a, b) => a.priority - b.priority);

    // Schedule processing
    this.scheduleProcessQueue();
  }

  /**
   * Queue a visited unlisted tree for sync
   */
  queueVisitedTree(key: string, cid: CID): void {
    const settings = this.getSyncSettings();
    if (!settings.enabled || !settings.syncVisitedUnlisted) return;

    // Visited unlisted trees have priority 1 (between own and followed)
    this.queueTreeSync(key, cid, false, 1);
  }

  private getSyncSettings(): SyncSettings {
    const state = get(settingsStore);
    return state.sync ?? DEFAULT_SYNC_SETTINGS;
  }

  private getOwnNpubs(): string[] {
    const accounts = get(accountsStore).accounts;
    return accounts.map(a => a.npub);
  }

  private subscribeToOwnTrees(): void {
    const resolver = getRefResolver();
    if (!resolver.list) return;

    const nostrState = get(nostrStore);
    if (!nostrState.npub) return;

    // Subscribe to current user's trees for cross-device sync
    // This includes ALL visibility levels (public, unlisted, private)
    // since we have access to our own trees
    const unsub = resolver.list(nostrState.npub, (entries) => {
      for (const entry of entries) {
        // Queue own trees with highest priority - all visibility levels
        // (we can decrypt our own unlisted/private trees)
        this.queueTreeSync(entry.key, entry.cid, true, 0);
      }
    });

    this.ownTreesUnsubscriber = unsub;
  }

  private subscribeToFollows(): void {
    const nostrState = get(nostrStore);
    if (!nostrState.pubkey) return;

    const followsStore = createFollowsStore(nostrState.pubkey);

    const handleFollowsUpdate = (follows: Follows | undefined) => {
      if (!follows) return;

      const settings = this.getSyncSettings();
      if (!settings.syncFollowedPublic) return;

      const followedPubkeys = follows.follows || [];
      const ownNpubs = new Set(this.getOwnNpubs());

      // Add subscriptions for new follows
      for (const pubkey of followedPubkeys) {
        const npub = pubkeyToNpub(pubkey);

        // Skip own accounts
        if (ownNpubs.has(npub)) continue;

        if (!this.treeListUnsubscribers.has(npub)) {
          this.subscribeToUserTrees(npub);
        }
      }

      // Remove subscriptions for unfollowed users
      const followedNpubs = new Set(followedPubkeys.map(pk => pubkeyToNpub(pk)));
      for (const [npub, unsub] of this.treeListUnsubscribers) {
        if (!followedNpubs.has(npub)) {
          unsub();
          this.treeListUnsubscribers.delete(npub);
        }
      }
    };

    // Subscribe to follows changes
    const unsub = followsStore.subscribe(handleFollowsUpdate);
    this.followsUnsubscribers.set('main', unsub);
  }

  private subscribeToUserTrees(npub: string): void {
    const resolver = getRefResolver();
    if (!resolver.list) return;

    const unsub = resolver.list(npub, (entries) => {
      for (const entry of entries) {
        // Only sync public trees from followed users
        if (entry.visibility === 'public') {
          this.queueTreeSync(entry.key, entry.cid, false, 2);
        }
      }
    });

    this.treeListUnsubscribers.set(npub, unsub);
  }

  private scheduleProcessQueue(): void {
    if (this.processQueueTimeoutId) return;

    // Process after a short delay to batch requests
    this.processQueueTimeoutId = setTimeout(() => {
      this.processQueueTimeoutId = null;
      this.processQueue();
    }, 100);
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.running) return;
    if (this.syncQueue.length === 0) return;

    this.processing = true;

    try {
      // Process one task at a time to avoid overloading
      const task = this.syncQueue.shift();
      if (!task) return;

      await this.syncTree(task);

      // Check quotas after each sync
      await this.checkQuotas();
    } catch (error) {
      console.error('[backgroundSync] Error processing queue:', error);
    } finally {
      this.processing = false;

      // Continue processing if more tasks
      if (this.syncQueue.length > 0 && this.running) {
        this.scheduleProcessQueue();
      }
    }
  }

  private async syncTree(task: SyncTask): Promise<void> {
    const { key, cid, isOwn } = task;

    // Check if already synced with same root
    const existingState = await getTreeSyncState(key);
    const rootHashHex = toHex(cid.hash);

    if (existingState && existingState.rootHash === rootHashHex) {
      // Already synced
      return;
    }

    console.log(`[backgroundSync] Syncing tree: ${key}`);

    try {
      // Use tree.pull() to recursively fetch all chunks
      const tree = getTree();
      const { chunks, bytes } = await tree.pull(cid);

      // Extract npub from key
      const ownerNpub = key.split('/')[0];

      // Update tree sync state
      const syncState: TreeSyncState = {
        key,
        ownerNpub,
        rootHash: rootHashHex,
        totalBytes: bytes,
        lastSynced: Date.now(),
        isOwn,
      };
      await updateTreeSyncState(syncState);

      console.log(`[backgroundSync] Synced ${key}: ${chunks} chunks, ${bytes} bytes`);
    } catch (error) {
      console.error(`[backgroundSync] Failed to sync ${key}:`, error);
    }
  }

  /**
   * Check and enforce storage quotas
   * Only runs when total storage exceeds cap
   */
  async checkQuotas(): Promise<void> {
    const settings = this.getSyncSettings();
    if (!settings.enabled) return;

    const totalBytes = await idbStore.totalBytes();
    if (totalBytes <= settings.storageCap) {
      // Under quota, nothing to do
      return;
    }

    console.log(`[backgroundSync] Storage ${totalBytes} exceeds cap ${settings.storageCap}, enforcing quotas`);

    // Get all "other" users (not own accounts)
    const ownNpubs = this.getOwnNpubs();
    const otherUsers = await getOtherUsersWithTrees(ownNpubs);

    if (otherUsers.length === 0) {
      // No other users to evict from
      return;
    }

    // Calculate per-user quota
    const othersQuota = settings.storageCap * (1 - settings.ownQuotaPercent / 100);
    const perUserQuota = othersQuota / otherUsers.length;

    // Check each user's usage and evict if over quota
    for (const npub of otherUsers) {
      const userBytes = await getStorageByUser(npub);
      if (userBytes > perUserQuota) {
        const toEvictBytes = userBytes - perUserQuota;
        console.log(`[backgroundSync] User ${npub.slice(0, 12)}... over quota by ${toEvictBytes} bytes`);

        const chunksToEvict = await getChunksToEvict(npub, toEvictBytes);

        // Delete chunks from IndexedDB
        for (const hashHex of chunksToEvict) {
          try {
            await idbStore.delete(fromHex(hashHex));
          } catch (error) {
            console.error(`[backgroundSync] Failed to delete chunk ${hashHex}:`, error);
          }
        }

        // Remove from metadata
        await removeChunks(chunksToEvict);

        console.log(`[backgroundSync] Evicted ${chunksToEvict.length} chunks from ${npub.slice(0, 12)}...`);
      }
    }
  }
}

// Singleton instance
let backgroundSyncInstance: BackgroundSyncService | null = null;

/**
 * Get or create the background sync service instance
 */
export function getBackgroundSync(): BackgroundSyncService {
  if (!backgroundSyncInstance) {
    backgroundSyncInstance = new BackgroundSyncService();
  }
  return backgroundSyncInstance;
}

/**
 * Start background sync (called on login)
 */
export function startBackgroundSync(): void {
  getBackgroundSync().start();
}

/**
 * Stop background sync (called on logout)
 */
export function stopBackgroundSync(): void {
  getBackgroundSync().stop();
}

/**
 * Queue a visited tree for sync
 */
export function queueVisitedTreeSync(key: string, cid: CID): void {
  getBackgroundSync().queueVisitedTree(key, cid);
}
