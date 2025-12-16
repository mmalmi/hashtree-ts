/**
 * Tree root store for Svelte
 *
 * This provides the rootCid from the URL via resolver subscription:
 * - For tree routes (/npub/treeName/...), subscribes to the resolver
 * - For permalink routes (/nhash1.../...), extracts hash directly from URL
 * - Returns null when no tree context
 */
import { writable, get, type Readable } from 'svelte/store';
import { fromHex, cid, visibilityHex } from 'hashtree';
import type { CID, SubscribeVisibilityInfo, Hash } from 'hashtree';
import { routeStore, parseRouteFromHash } from './route';
import { getRefResolver, getResolverKey } from '../refResolver';
import { nostrStore, getSecretKey } from '../nostr';
import { nip44 } from 'nostr-tools';

// Shared subscription cache - stores raw resolver data, not decrypted CIDs
const subscriptionCache = new Map<string, {
  hash: Hash | null;
  encryptionKey: Hash | undefined;
  visibilityInfo: SubscribeVisibilityInfo | undefined;
  decryptedKey: Hash | undefined;
  listeners: Set<(hash: Hash | null, encryptionKey?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void>;
  unsubscribe: (() => void) | null;
}>();

/**
 * Update the subscription cache directly (called from treeRootCache on local writes)
 */
export function updateSubscriptionCache(key: string, hash: Hash, encryptionKey?: Hash): void {
  let cached = subscriptionCache.get(key);
  if (!cached) {
    // Create entry if it doesn't exist (for newly created trees)
    cached = {
      hash: null,
      encryptionKey: undefined,
      visibilityInfo: undefined,
      decryptedKey: undefined,
      listeners: new Set(),
      unsubscribe: null,
    };
    subscriptionCache.set(key, cached);
  }
  cached.hash = hash;
  cached.encryptionKey = encryptionKey;
  cached.decryptedKey = encryptionKey;
  cached.listeners.forEach(listener => listener(hash, encryptionKey, cached!.visibilityInfo));
}

function subscribeToResolver(
  key: string,
  callback: (hash: Hash | null, encryptionKey?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void
): () => void {
  let entry = subscriptionCache.get(key);

  if (!entry) {
    entry = {
      hash: null,
      encryptionKey: undefined,
      visibilityInfo: undefined,
      decryptedKey: undefined,
      listeners: new Set(),
      unsubscribe: null,
    };
    subscriptionCache.set(key, entry);

    const resolver = getRefResolver();
    entry.unsubscribe = resolver.subscribe(key, (resolvedCid, visibilityInfo) => {
      const cached = subscriptionCache.get(key);
      if (cached) {
        cached.hash = resolvedCid?.hash ?? null;
        cached.encryptionKey = resolvedCid?.key;
        cached.visibilityInfo = visibilityInfo;
        cached.listeners.forEach(listener => listener(resolvedCid?.hash ?? null, resolvedCid?.key, visibilityInfo));
      }
    });
  }

  entry.listeners.add(callback);

  if (entry.hash) {
    callback(entry.hash, entry.encryptionKey, entry.visibilityInfo);
  }

  return () => {
    const cached = subscriptionCache.get(key);
    if (cached) {
      cached.listeners.delete(callback);
      // Note: We don't delete the cache entry when the last listener unsubscribes
      // because the data is still valid and may be needed by other components
      // (e.g., DocCard uses getTreeRootSync after the editor unmounts)
      if (cached.listeners.size === 0) {
        cached.unsubscribe?.();
        // Keep the cached data, just stop the subscription
        // subscriptionCache.delete(key);
      }
    }
  };
}

/**
 * Decrypt the encryption key for a tree based on visibility and available keys
 */
async function decryptEncryptionKey(
  visibilityInfo: SubscribeVisibilityInfo | undefined,
  encryptionKey: Hash | undefined,
  linkKey: string | null
): Promise<Hash | undefined> {
  if (encryptionKey) {
    return encryptionKey;
  }

  if (!visibilityInfo) {
    return undefined;
  }

  // Unlisted tree with linkKey from URL
  if (visibilityInfo.visibility === 'unlisted' && visibilityInfo.encryptedKey && linkKey) {
    try {
      const decryptedHex = await visibilityHex.decryptKeyFromLink(visibilityInfo.encryptedKey, linkKey);
      if (decryptedHex) {
        return fromHex(decryptedHex);
      }
      console.warn('[decryptEncryptionKey] Key mismatch - linkKey does not decrypt encryptedKey');
    } catch (e) {
      console.error('[decryptEncryptionKey] Decryption failed:', e);
    }
  }

  // Unlisted or private tree - try selfEncryptedKey (owner access)
  if (visibilityInfo.selfEncryptedKey) {
    try {
      const state = get(nostrStore);
      const sk = getSecretKey();
      if (sk && state.pubkey) {
        const conversationKey = nip44.v2.utils.getConversationKey(sk, state.pubkey);
        const decrypted = nip44.v2.decrypt(visibilityInfo.selfEncryptedKey, conversationKey);
        return fromHex(decrypted);
      }
    } catch (e) {
      console.debug('Could not decrypt selfEncryptedKey (not owner?):', e);
    }
  }

  return undefined;
}

// Store for tree root
export const treeRootStore = writable<CID | null>(null);

// Active subscription cleanup
let activeUnsubscribe: (() => void) | null = null;
let activeResolverKey: string | null = null;

/**
 * Create a tree root store that reacts to route changes
 */
export function createTreeRootStore(): Readable<CID | null> {
  // Subscribe to route changes
  routeStore.subscribe(async (route) => {
    // For permalinks, use CID from route
    if (route.isPermalink && route.cid) {
      const key = route.cid.key ? fromHex(route.cid.key) : undefined;
      treeRootStore.set(cid(fromHex(route.cid.hash), key));

      // Cleanup any active subscription
      if (activeUnsubscribe) {
        activeUnsubscribe();
        activeUnsubscribe = null;
        activeResolverKey = null;
      }
      return;
    }

    // For tree routes, subscribe to resolver
    const resolverKey = getResolverKey(route.npub ?? undefined, route.treeName ?? undefined);

    if (!resolverKey) {
      treeRootStore.set(null);
      if (activeUnsubscribe) {
        activeUnsubscribe();
        activeUnsubscribe = null;
        activeResolverKey = null;
      }
      return;
    }

    // Same key, no need to resubscribe
    if (resolverKey === activeResolverKey) {
      return;
    }

    // Cleanup previous subscription
    if (activeUnsubscribe) {
      activeUnsubscribe();
    }

    // Reset while waiting for new data
    treeRootStore.set(null);
    activeResolverKey = resolverKey;

    // Subscribe to resolver
    activeUnsubscribe = subscribeToResolver(resolverKey, async (hash, encryptionKey, visibilityInfo) => {
      if (!hash) {
        treeRootStore.set(null);
        return;
      }

      const decryptedKey = await decryptEncryptionKey(visibilityInfo, encryptionKey, route.linkKey);

      // Cache the decrypted key
      if (decryptedKey) {
        const cached = subscriptionCache.get(resolverKey);
        if (cached) {
          cached.decryptedKey = decryptedKey;
        }
      }

      treeRootStore.set(cid(hash, decryptedKey));
    });
  });

  return treeRootStore;
}

/**
 * Get the current root CID synchronously
 */
export function getTreeRootSync(npub: string | null | undefined, treeName: string | null | undefined): CID | null {
  const key = getResolverKey(npub ?? undefined, treeName ?? undefined);
  if (!key) return null;

  const cached = subscriptionCache.get(key);
  if (!cached?.hash) return null;

  const encryptionKey = cached.decryptedKey ?? cached.encryptionKey;
  return cid(cached.hash, encryptionKey);
}

/**
 * Invalidate and refresh the cached root CID
 */
export function invalidateTreeRoot(npub: string | null | undefined, treeName: string | null | undefined): void {
  const key = getResolverKey(npub ?? undefined, treeName ?? undefined);
  if (!key) return;
  // The resolver subscription will automatically pick up the new value
}

// Synchronously parse initial permalink (no resolver needed for nhash URLs)
// This must run BEFORE currentDirHash.ts subscribes to avoid race condition
function initializePermalink(): void {
  if (typeof window === 'undefined') return;

  const route = parseRouteFromHash(window.location.hash);
  if (route.isPermalink && route.cid) {
    const key = route.cid.key ? fromHex(route.cid.key) : undefined;
    treeRootStore.set(cid(fromHex(route.cid.hash), key));
  }
}

// Initialize permalink synchronously (before currentDirHash subscribes)
initializePermalink();

// Initialize the store once - guard against HMR re-initialization
// Store the flag on a global to persist across HMR module reloads
const HMR_KEY = '__treeRootStoreInitialized';
const globalObj = typeof globalThis !== 'undefined' ? globalThis : window;

// Use queueMicrotask to defer until after module initialization completes
// This avoids circular dependency issues with nostr.ts -> store.ts
queueMicrotask(() => {
  if ((globalObj as Record<string, unknown>)[HMR_KEY]) return;
  (globalObj as Record<string, unknown>)[HMR_KEY] = true;
  createTreeRootStore();
});
