/**
 * Ref resolver singleton for the explorer app
 *
 * Provides access to the NostrRefResolver which maps npub/treename keys
 * to merkle root hashes (refs), with subscription support for live updates.
 */
import { nip19 } from 'nostr-tools';
import { NDKEvent, type NDKFilter, type NDKSubscriptionOptions } from '@nostr-dev-kit/ndk';
import { createNostrRefResolver, type RefResolver, type NostrFilter, type NostrEvent } from 'hashtree';
import { ndk, useNostrStore } from './nostr';

let resolver: RefResolver | null = null;

/**
 * Get the ref resolver instance (creates it on first call)
 */
export function getRefResolver(): RefResolver {
  if (!resolver) {
    resolver = createNostrRefResolver({
      subscribe: (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => {
        const ndkFilter: NDKFilter = {
          kinds: filter.kinds,
          authors: filter.authors,
          '#d': filter['#d'],
          '#l': filter['#l'],
        };
        const opts: NDKSubscriptionOptions = { closeOnEose: false };
        const sub = ndk.subscribe(ndkFilter, opts);
        sub.on('event', (e: NDKEvent) => {
          onEvent({
            id: e.id,
            pubkey: e.pubkey,
            kind: e.kind ?? 30078,
            content: e.content,
            tags: e.tags,
            created_at: e.created_at ?? 0,
          });
        });
        return () => sub.stop();
      },
      publish: async (event) => {
        try {
          const ndkEvent = new NDKEvent(ndk);
          ndkEvent.kind = event.kind;
          ndkEvent.content = event.content;
          ndkEvent.tags = event.tags;
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

  // Use the resolver's publish method which updates local cache only (no Nostr publish)
  const { fromHex, cid } = await import('hashtree');
  const hash = fromHex(hashHex);
  const encryptionKey = keyHex ? fromHex(keyHex) : undefined;
  await res.publish?.(key, cid(hash, encryptionKey), { visibility });
}

