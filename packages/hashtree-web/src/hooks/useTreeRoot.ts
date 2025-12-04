/**
 * Hook to get the root CID from the URL via resolver subscription
 *
 * This hook derives the rootCid from the URL:
 * - For tree routes (/npub/treeName/...), subscribes to the resolver
 * - For permalink routes (/nhash1.../...), extracts hash directly from URL
 * - Returns null when no tree context
 *
 * Components use this instead of reading rootCid from global app state.
 */
import { useState, useEffect, useRef } from 'react';
import { fromHex, nhashDecode, cid } from 'hashtree';
import type { CID } from 'hashtree';
import { useRoute } from './useRoute';
import { getRefResolver, getResolverKey } from '../refResolver';

// Shared subscription cache to avoid duplicate resolver subscriptions
const subscriptionCache = new Map<string, {
  cid: CID | null;
  listeners: Set<(cid: CID | null) => void>;
  unsubscribe: (() => void) | null;
}>();

function subscribeToResolver(key: string, callback: (cid: CID | null) => void): () => void {
  let entry = subscriptionCache.get(key);

  if (!entry) {
    // First subscriber for this key - create subscription
    entry = {
      cid: null,
      listeners: new Set(),
      unsubscribe: null,
    };
    subscriptionCache.set(key, entry);

    const resolver = getRefResolver();
    entry.unsubscribe = resolver.subscribe(key, (hash, encryptionKey) => {
      const newCid = hash ? cid(hash, encryptionKey) : null;
      const cached = subscriptionCache.get(key);
      if (cached) {
        cached.cid = newCid;
        cached.listeners.forEach(listener => listener(newCid));
      }
    });
  }

  // Add this callback to listeners
  entry.listeners.add(callback);

  // If we already have a cached value, call callback immediately
  if (entry.cid) {
    callback(entry.cid);
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
 * Hook to get the current tree's root CID from URL via resolver
 *
 * @returns The root CID (hash + optional encryption key) or null if not in a tree context
 */
export function useTreeRoot(): CID | null {
  const route = useRoute();
  const [rootCid, setRootCid] = useState<CID | null>(null);
  const lastKeyRef = useRef<string | null>(null);

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
      return;
    }

    // Avoid re-subscribing to the same key
    if (lastKeyRef.current === resolverKey) {
      return;
    }
    lastKeyRef.current = resolverKey;

    // Subscribe to resolver for live updates
    const unsubscribe = subscribeToResolver(resolverKey, (newCid) => {
      setRootCid(newCid);
    });

    return unsubscribe;
  }, [route.npub, route.treeName, route.hash, route.isPermalink]);

  return rootCid;
}

/**
 * Non-hook function to get the current root CID synchronously
 * Used in actions that run outside React components
 *
 * @param npub - User's npub
 * @param treeName - Tree name
 * @returns The cached root CID or null
 */
export function getTreeRootSync(npub: string | null | undefined, treeName: string | null | undefined): CID | null {
  const key = getResolverKey(npub ?? undefined, treeName ?? undefined);
  if (!key) return null;

  const cached = subscriptionCache.get(key);
  return cached?.cid ?? null;
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
