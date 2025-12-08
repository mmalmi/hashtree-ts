/**
 * Local cache for tracking the most recent root hash for each tree
 *
 * This is the SINGLE SOURCE OF TRUTH for the current merkle root.
 * All writes go here immediately, publishing to Nostr is throttled.
 *
 * Key: "npub/treeName", Value: { hash, key, dirty }
 */
import type { Hash } from 'hashtree';
import { fromHex, toHex } from 'hashtree';
import { updateSubscriptionCache } from './hooks/useTreeRoot';

interface CacheEntry {
  hash: Hash;
  key?: Hash;
  dirty: boolean; // true if not yet published to Nostr
}

const localRootCache = new Map<string, CacheEntry>();

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
 */
export function updateLocalRootCache(npub: string, treeName: string, hash: Hash, key?: Hash) {
  const cacheKey = `${npub}/${treeName}`;
  localRootCache.set(cacheKey, { hash, key, dirty: true });
  notifyListeners(npub, treeName);
  schedulePublish(npub, treeName);

  // Update subscription cache to trigger immediate UI update
  updateSubscriptionCache(cacheKey, hash, key);
}

/**
 * Update the local root cache (hex version)
 */
export function updateLocalRootCacheHex(npub: string, treeName: string, hashHex: string, keyHex?: string) {
  updateLocalRootCache(
    npub,
    treeName,
    fromHex(hashHex),
    keyHex ? fromHex(keyHex) : undefined
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

    const success = await publishTreeRoot(treeName, hashHex, keyHex);

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
