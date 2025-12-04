/**
 * Hook to get the root CID from the URL via resolver subscription
 *
 * This hook derives the rootCid from the URL:
 * - For tree routes (/npub/treeName/...), subscribes to the resolver
 * - For permalink routes (/nhash1.../...), extracts hash directly from URL
 * - Returns null when no tree context
 *
 * For unlisted trees, if a linkKey is in the URL (?k=...), it's used to
 * decrypt the encryptedKey from the nostr event.
 *
 * Components use this instead of reading rootCid from global app state.
 */
import { useState, useEffect, useRef } from 'react';
import { fromHex, nhashDecode, cid, visibilityHex } from 'hashtree';
import type { CID, SubscribeVisibilityInfo, Hash } from 'hashtree';
import { useRoute } from './useRoute';
import { getRefResolver, getResolverKey } from '../refResolver';
import { useNostrStore } from '../nostr';
import { nip04 } from 'nostr-tools';

// Shared subscription cache - stores raw resolver data, not decrypted CIDs
// Each subscriber may need different decryption based on their linkKey
const subscriptionCache = new Map<string, {
  hash: Hash | null;
  encryptionKey: Hash | undefined;
  visibilityInfo: SubscribeVisibilityInfo | undefined;
  /** Decrypted key for unlisted/private trees - cached after first decryption */
  decryptedKey: Hash | undefined;
  listeners: Set<(hash: Hash | null, encryptionKey?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void>;
  unsubscribe: (() => void) | null;
}>();

function subscribeToResolver(
  key: string,
  callback: (hash: Hash | null, encryptionKey?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void
): () => void {
  let entry = subscriptionCache.get(key);

  if (!entry) {
    // First subscriber for this key - create subscription
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
    entry.unsubscribe = resolver.subscribe(key, (hash, encryptionKey, visibilityInfo) => {
      const cached = subscriptionCache.get(key);
      if (cached) {
        cached.hash = hash;
        cached.encryptionKey = encryptionKey;
        cached.visibilityInfo = visibilityInfo;
        cached.listeners.forEach(listener => listener(hash, encryptionKey, visibilityInfo));
      }
    });
  }

  // Add this callback to listeners
  entry.listeners.add(callback);

  // If we already have a cached value, call callback immediately
  if (entry.hash) {
    callback(entry.hash, entry.encryptionKey, entry.visibilityInfo);
  }

  // Return unsubscribe function
  return () => {
    const cached = subscriptionCache.get(key);
    if (cached) {
      cached.listeners.delete(callback);
      // If no more listeners, clean up the subscription
      if (cached.listeners.size === 0) {
        cached.unsubscribe?.();
        subscriptionCache.delete(key);
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
  // Public tree - key is already decrypted
  if (encryptionKey) {
    return encryptionKey;
  }

  if (!visibilityInfo) {
    return undefined;
  }

  // Unlisted tree with linkKey from URL - decrypt encryptedKey
  if (visibilityInfo.visibility === 'unlisted' && visibilityInfo.encryptedKey && linkKey) {
    try {
      const decryptedHex = await visibilityHex.decryptKeyFromLink(visibilityInfo.encryptedKey, linkKey);
      if (decryptedHex) {
        return fromHex(decryptedHex);
      }
    } catch (e) {
      console.error('Failed to decrypt link key:', e);
    }
  }

  // Unlisted or private tree - try selfEncryptedKey (owner access)
  if (visibilityInfo.selfEncryptedKey) {
    try {
      const store = useNostrStore.getState();
      if (store.secretKey && store.pubkey) {
        const decrypted = await nip04.decrypt(store.secretKey, store.pubkey, visibilityInfo.selfEncryptedKey);
        return fromHex(decrypted);
      }
    } catch (e) {
      // Not the owner or decryption failed
      console.debug('Could not decrypt selfEncryptedKey (not owner?):', e);
    }
  }

  return undefined;
}

/**
 * Hook to get the current tree's root CID from URL via resolver
 *
 * @returns The root CID (hash + optional encryption key) or null if not in a tree context
 */
export function useTreeRoot(): CID | null {
  const route = useRoute();
  const [rootCid, setRootCid] = useState<CID | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const lastLinkKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // For permalinks (nhash routes), extract hash directly from URL
    if (route.isPermalink && route.hash) {
      try {
        const decoded = nhashDecode(route.hash);
        // nhash contains just the hash, no encryption key
        setRootCid(cid(fromHex(decoded.hash)));
      } catch {
        setRootCid(null);
      }
      return;
    }

    // For tree routes, subscribe to resolver
    const resolverKey = getResolverKey(route.npub ?? undefined, route.treeName ?? undefined);

    if (!resolverKey) {
      // No tree context (home, settings, etc.)
      setRootCid(null);
      lastKeyRef.current = null;
      lastLinkKeyRef.current = null;
      return;
    }

    // Re-subscribe if key or linkKey changed
    const keyChanged = lastKeyRef.current !== resolverKey;
    const linkKeyChanged = lastLinkKeyRef.current !== route.linkKey;

    if (!keyChanged && !linkKeyChanged) {
      return;
    }
    lastKeyRef.current = resolverKey;
    lastLinkKeyRef.current = route.linkKey;

    // Subscribe to resolver for live updates
    const unsubscribe = subscribeToResolver(resolverKey, async (hash, encryptionKey, visibilityInfo) => {
      if (!hash) {
        setRootCid(null);
        return;
      }

      // Decrypt the encryption key based on visibility and available keys
      const decryptedKey = await decryptEncryptionKey(visibilityInfo, encryptionKey, route.linkKey);

      // Cache the decrypted key for sync access (used by getTreeRootSync)
      if (decryptedKey) {
        const cached = subscriptionCache.get(resolverKey);
        if (cached) {
          cached.decryptedKey = decryptedKey;
        }
      }

      setRootCid(cid(hash, decryptedKey));
    });

    return unsubscribe;
  }, [route.npub, route.treeName, route.hash, route.isPermalink, route.linkKey]);

  return rootCid;
}

/**
 * Non-hook function to get the current root CID synchronously
 * Used in actions that run outside React components
 *
 * For public trees, returns the encryption key from the resolver.
 * For unlisted/private trees, returns the decrypted key if available in cache.
 *
 * @param npub - User's npub
 * @param treeName - Tree name
 * @returns The cached root CID or null
 */
export function getTreeRootSync(npub: string | null | undefined, treeName: string | null | undefined): CID | null {
  const key = getResolverKey(npub ?? undefined, treeName ?? undefined);
  if (!key) return null;

  const cached = subscriptionCache.get(key);
  if (!cached?.hash) return null;

  // Use decrypted key if available (for unlisted/private trees),
  // otherwise use encryptionKey (for public trees)
  const encryptionKey = cached.decryptedKey ?? cached.encryptionKey;
  return cid(cached.hash, encryptionKey);
}

/**
 * Invalidate and refresh the cached root CID
 * Call this after publishing a new root hash to ensure subscribers get the update
 */
export function invalidateTreeRoot(npub: string | null | undefined, treeName: string | null | undefined): void {
  const key = getResolverKey(npub ?? undefined, treeName ?? undefined);
  if (!key) return;

  // The resolver subscription will automatically pick up the new value
  // No need to manually invalidate - the nostr subscription handles this
}
