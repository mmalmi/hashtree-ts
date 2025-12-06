/**
 * Local cache for tracking the most recent root hash for each tree
 *
 * This avoids relying on nostr round-trip which can be stale.
 * When a tree is saved locally, we update this cache immediately.
 * This ensures subsequent saves from other components use the latest hash.
 *
 * Key: "npub/treeName", Value: root hash
 */
import type { Hash } from 'hashtree';
import { fromHex } from 'hashtree';

const localRootCache = new Map<string, Hash>();

/**
 * Update the local root cache after a save
 */
export function updateLocalRootCache(npub: string, treeName: string, hash: Hash) {
  localRootCache.set(`${npub}/${treeName}`, hash);
}

/**
 * Update the local root cache after a save (hex version)
 */
export function updateLocalRootCacheHex(npub: string, treeName: string, hashHex: string) {
  localRootCache.set(`${npub}/${treeName}`, fromHex(hashHex));
}

/**
 * Get cached root hash for a tree (if available)
 */
export function getLocalRootCache(npub: string, treeName: string): Hash | undefined {
  return localRootCache.get(`${npub}/${treeName}`);
}
