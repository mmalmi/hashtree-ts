/**
 * Ref resolver singleton for the explorer app
 *
 * Provides access to the NostrRefResolver which maps npub/treename keys
 * to merkle root hashes (refs), with subscription support for live updates.
 */
import { nip19 } from 'nostr-tools';
import { NDKEvent, type NDKFilter, type NDKSubscriptionOptions, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk';
import { createNostrRefResolver, type RefResolver, type NostrFilter, type NostrEvent } from 'hashtree';
import { ndk, useNostrStore } from './nostr';

// Use window to store the resolver to ensure it's truly a singleton
// even if the module is reloaded by HMR or there are multiple bundle instances
declare global {
  interface Window {
    __hashtreeResolver?: RefResolver;
  }
}

/**
 * Wait for NDK to have at least one connected relay
 * Returns immediately if already connected
 */
async function waitForNdkConnection(timeout = 10000): Promise<boolean> {
  const checkConnected = () => {
    const pool = ndk.pool;
    if (!pool) return false;
    for (const relay of pool.relays.values()) {
      // NDKRelayStatus.CONNECTED = 5
      if (relay.status >= 5) return true;
    }
    return false;
  };

  // Already connected
  if (checkConnected()) return true;

  // Wait for connection
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (checkConnected()) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Get the ref resolver instance (creates it on first call)
 */
export function getRefResolver(): RefResolver {
  // Check window first to ensure true singleton
  if (typeof window !== 'undefined' && window.__hashtreeResolver) {
    return window.__hashtreeResolver;
  }
  const resolver = createNostrRefResolver({
      subscribe: (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => {
        const ndkFilter: NDKFilter = {
          kinds: filter.kinds,
          authors: filter.authors,
          '#d': filter['#d'],
          '#l': filter['#l'],
        };
        const opts: NDKSubscriptionOptions = {
          closeOnEose: false,
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        };

        // Track if subscription is still active
        let active = true;

        // Ensure NDK is connected before subscribing
        // This prevents race conditions where subscription is created before relay connection
        waitForNdkConnection().then((connected) => {
          if (!active) return; // Subscription was cancelled
          if (!connected) {
            console.warn('[refResolver] NDK connection timeout, subscription may not receive events');
          }

          const sub = ndk.subscribe(ndkFilter, opts);
          sub.on('event', (e: NDKEvent) => {
            if (!active) return;
            onEvent({
              id: e.id,
              pubkey: e.pubkey,
              kind: e.kind ?? 30078,
              content: e.content,
              tags: e.tags,
              created_at: e.created_at ?? 0,
            });
          });

          // Store unsubscribe in closure for cleanup
          const originalUnsubscribe = unsubscribe;
          unsubscribe = () => {
            active = false;
            sub.stop();
            originalUnsubscribe?.();
          };
        });

        let unsubscribe: (() => void) | undefined = () => {
          active = false;
        };

        return () => unsubscribe?.();
      },
      publish: async (event) => {
        try {
          const ndkEvent = new NDKEvent(ndk);
          ndkEvent.kind = event.kind;
          ndkEvent.content = event.content;
          ndkEvent.tags = event.tags;
          // Pass through created_at if set (important for delete events to have higher timestamp)
          if (event.created_at) {
            ndkEvent.created_at = event.created_at;
          }
          await ndkEvent.publish();
          return true;
        } catch (e) {
          console.error('Failed to publish event:', e);
          return false;
        }
      },
      getPubkey: () => useNostrStore.getState().pubkey,
      nip19,
    });

  // Store on window for true singleton across HMR/bundle reloads
  if (typeof window !== 'undefined') {
    window.__hashtreeResolver = resolver;
  }

  return resolver;
}

/**
 * Build a resolver key from npub and tree name
 */
export function getResolverKey(npub: string | undefined, treeName: string | undefined): string | null {
  if (!npub || !treeName) return null;
  return `${npub}/${treeName}`;
}

/**
 * Update local tree cache for instant UI updates.
 * This makes the tree appear immediately without waiting for Nostr relay.
 * NOTE: This does NOT publish to Nostr - the caller handles that separately.
 */
export async function updateLocalTreeCache(
  npub: string,
  treeName: string,
  hashHex: string,
  keyHex?: string,
  visibility: 'public' | 'unlisted' | 'private' = 'public'
): Promise<void> {
  const key = `${npub}/${treeName}`;
  const res = getRefResolver();

  // Use the resolver's publish method which updates local cache only
  // IMPORTANT: skipNostrPublish=true to avoid re-publishing without visibility tags
  const { fromHex, cid } = await import('hashtree');
  const hash = fromHex(hashHex);
  const encryptionKey = keyHex ? fromHex(keyHex) : undefined;
  await res.publish?.(key, cid(hash, encryptionKey), { visibility }, true);
}

