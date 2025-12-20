/**
 * Local cache for tracking the most recent root hash for each tree
 *
 * This is the SINGLE SOURCE OF TRUTH for the current merkle root.
 * All writes go here immediately, publishing to Nostr is throttled.
 *
 * Key: "npub/treeName", Value: { hash, key, visibility, dirty }
 *
 * Uses BroadcastChannel to sync cache across all tabs in the same browser.
 * This is critical for live streaming where the broadcaster tab writes data
 * and viewer tabs need immediate access to the latest tree root.
 */
import type { Hash, TreeVisibility } from 'hashtree';
import { fromHex, toHex } from 'hashtree';
import { updateSubscriptionCache } from './stores/treeRoot';

interface CacheEntry {
  hash: Hash;
  key?: Hash;
  visibility?: TreeVisibility;
  dirty: boolean; // true if not yet published to Nostr
}

const localRootCache = new Map<string, CacheEntry>();

// BroadcastChannel for cross-tab sync of tree root cache
// This ensures viewer tabs get immediate updates when broadcaster writes
const CHANNEL_NAME = 'iris-files-tree-root-cache';
let broadcastChannel: BroadcastChannel | null = null;

interface BroadcastMessage {
  type: 'tree-root-update' | 'tree-root-request' | 'tree-root-response';
  cacheKey: string;
  hashHex?: string;
  keyHex?: string;
  requestId?: string;
}

function initBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (broadcastChannel) return broadcastChannel;

  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const msg = event.data;

      if (msg.type === 'tree-root-update') {
        // Update local cache from other tab (don't mark as dirty - we're not the writer)
        if (!msg.hashHex) return;
        const hash = fromHex(msg.hashHex);
        const key = msg.keyHex ? fromHex(msg.keyHex) : undefined;

        // Only update if we don't already have this entry OR our entry is older
        // We don't broadcast back to avoid loops
        const existing = localRootCache.get(msg.cacheKey);
        if (!existing || toHex(existing.hash) !== msg.hashHex) {
          localRootCache.set(msg.cacheKey, {
            hash,
            key,
            visibility: existing?.visibility, // preserve local visibility
            dirty: false, // received from another tab, not our write
          });

          // Update subscription cache for UI updates
          updateSubscriptionCache(msg.cacheKey, hash, key);

          // Notify local listeners
          const [npub, treeName] = msg.cacheKey.split('/');
          notifyListeners(npub, treeName);
        }
      } else if (msg.type === 'tree-root-request') {
        // Another tab is requesting the current tree root - respond if we have it
        const cached = localRootCache.get(msg.cacheKey);
        if (cached && cached.hash) {
          const response: BroadcastMessage = {
            type: 'tree-root-response',
            cacheKey: msg.cacheKey,
            hashHex: toHex(cached.hash),
            keyHex: cached.key ? toHex(cached.key) : undefined,
            requestId: msg.requestId,
          };
          try {
            broadcastChannel?.postMessage(response);
          } catch (e) {
            // Channel might be closed
          }
        }
      } else if (msg.type === 'tree-root-response') {
        // Response to our request - check if we have a pending request
        if (!msg.hashHex) return;
        const hash = fromHex(msg.hashHex);
        const key = msg.keyHex ? fromHex(msg.keyHex) : undefined;

        // Update cache if we don't have this entry or ours is different
        const existing = localRootCache.get(msg.cacheKey);
        if (!existing || toHex(existing.hash) !== msg.hashHex) {
          localRootCache.set(msg.cacheKey, {
            hash,
            key,
            visibility: existing?.visibility,
            dirty: false,
          });

          // Update subscription cache for UI updates
          updateSubscriptionCache(msg.cacheKey, hash, key);

          // Notify local listeners
          const [npub, treeName] = msg.cacheKey.split('/');
          notifyListeners(npub, treeName);
        }
      }
    };
    return broadcastChannel;
  } catch (e) {
    console.warn('[TreeRootCache] BroadcastChannel not available:', e);
    return null;
  }
}

// Initialize on load
initBroadcastChannel();

/**
 * Request tree root from other tabs via BroadcastChannel
 * Used when we need the latest tree root that might not be in our local cache
 */
export function requestTreeRootFromOtherTabs(npub: string, treeName: string): void {
  const channel = initBroadcastChannel();
  if (channel) {
    const message: BroadcastMessage = {
      type: 'tree-root-request',
      cacheKey: `${npub}/${treeName}`,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    try {
      channel.postMessage(message);
    } catch (e) {
      // Channel might be closed
    }
  }
}

// Throttle timers per tree
const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Publish delay in ms (throttle)
const PUBLISH_DELAY = 1000;

// Listeners for cache updates
const listeners = new Set<(npub: string, treeName: string) => void>();

/**
 * Subscribe to cache updates
 */
export function onCacheUpdate(listener: (npub: string, treeName: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(npub: string, treeName: string) {
  for (const listener of listeners) {
    try {
      listener(npub, treeName);
    } catch (e) {
      console.error('Cache listener error:', e);
    }
  }
}

/**
 * Update the local root cache after a write operation.
 * This should be the ONLY place that tracks merkle root changes.
 * Publishing to Nostr is throttled - multiple rapid updates result in one publish.
 *
 * Also broadcasts to other tabs via BroadcastChannel for cross-tab sync.
 */
export function updateLocalRootCache(npub: string, treeName: string, hash: Hash, key?: Hash, visibility?: TreeVisibility) {
  const cacheKey = `${npub}/${treeName}`;
  // Preserve existing visibility if not provided (for incremental updates that don't change visibility)
  const existing = localRootCache.get(cacheKey);
  const finalVisibility = visibility ?? existing?.visibility;
  localRootCache.set(cacheKey, { hash, key, visibility: finalVisibility, dirty: true });
  notifyListeners(npub, treeName);
  schedulePublish(npub, treeName);

  // Update subscription cache to trigger immediate UI update
  updateSubscriptionCache(cacheKey, hash, key);

  // Broadcast to other tabs for cross-tab sync (critical for live streaming)
  const channel = initBroadcastChannel();
  if (channel) {
    const message: BroadcastMessage = {
      type: 'tree-root-update',
      cacheKey,
      hashHex: toHex(hash),
      keyHex: key ? toHex(key) : undefined,
    };
    try {
      channel.postMessage(message);
    } catch (e) {
      // Channel might be closed, ignore
    }
  }
}

/**
 * Get the visibility for a cached tree
 */
export function getCachedVisibility(npub: string, treeName: string): TreeVisibility | undefined {
  return localRootCache.get(`${npub}/${treeName}`)?.visibility;
}

/**
 * Update the local root cache (hex version)
 */
export function updateLocalRootCacheHex(npub: string, treeName: string, hashHex: string, keyHex?: string, visibility?: TreeVisibility) {
  updateLocalRootCache(
    npub,
    treeName,
    fromHex(hashHex),
    keyHex ? fromHex(keyHex) : undefined,
    visibility
  );
}

/**
 * Get cached root hash for a tree (if available)
 */
export function getLocalRootCache(npub: string, treeName: string): Hash | undefined {
  return localRootCache.get(`${npub}/${treeName}`)?.hash;
}

/**
 * Get cached root key for a tree (if available)
 */
export function getLocalRootKey(npub: string, treeName: string): Hash | undefined {
  return localRootCache.get(`${npub}/${treeName}`)?.key;
}

/**
 * Get all entries from the local root cache
 */
export function getAllLocalRoots(): Map<string, { hash: Hash; key?: Hash; visibility?: TreeVisibility }> {
  const result = new Map<string, { hash: Hash; key?: Hash; visibility?: TreeVisibility }>();
  for (const [key, entry] of localRootCache.entries()) {
    result.set(key, { hash: entry.hash, key: entry.key, visibility: entry.visibility });
  }
  return result;
}

/**
 * Get full cache entry
 */
export function getLocalRootEntry(npub: string, treeName: string): CacheEntry | undefined {
  return localRootCache.get(`${npub}/${treeName}`);
}

/**
 * Schedule a throttled publish to Nostr
 */
function schedulePublish(npub: string, treeName: string) {
  const cacheKey = `${npub}/${treeName}`;

  // Clear existing timer
  const existingTimer = publishTimers.get(cacheKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new publish
  const timer = setTimeout(() => {
    publishTimers.delete(cacheKey);
    doPublish(npub, treeName);
  }, PUBLISH_DELAY);

  publishTimers.set(cacheKey, timer);
}

/**
 * Cancel any pending publish for a tree (call before delete)
 * This prevents the throttled publish from "undeleting" the tree
 */
export function cancelPendingPublish(npub: string, treeName: string): void {
  const cacheKey = `${npub}/${treeName}`;
  const timer = publishTimers.get(cacheKey);
  if (timer) {
    clearTimeout(timer);
    publishTimers.delete(cacheKey);
  }
  // Also remove from cache to prevent any future publish
  localRootCache.delete(cacheKey);
}

/**
 * Actually publish to Nostr (called after throttle delay)
 */
async function doPublish(npub: string, treeName: string) {
  const cacheKey = `${npub}/${treeName}`;
  const entry = localRootCache.get(cacheKey);
  if (!entry || !entry.dirty) return;

  try {
    // Dynamic import to avoid circular dependency
    const { publishTreeRoot } = await import('./nostr');

    const hashHex = toHex(entry.hash);
    const keyHex = entry.key ? toHex(entry.key) : undefined;
    // Use cached visibility to ensure correct tags are published even after navigation
    const visibility = entry.visibility;

    const success = await publishTreeRoot(treeName, hashHex, keyHex, visibility);

    if (success) {
      // Mark as clean (published)
      // Re-check entry in case it changed during async publish
      const currentEntry = localRootCache.get(cacheKey);
      if (currentEntry && toHex(currentEntry.hash) === hashHex) {
        currentEntry.dirty = false;
      }
    }
  } catch (e) {
    console.error('Failed to publish tree root:', e);
    // Will retry on next update
  }
}

/**
 * Force immediate publish (for critical operations like logout)
 */
export async function flushPendingPublishes(): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [cacheKey, timer] of publishTimers) {
    clearTimeout(timer);
    publishTimers.delete(cacheKey);

    const [npub, treeName] = cacheKey.split('/');
    promises.push(doPublish(npub, treeName));
  }

  await Promise.all(promises);
}
