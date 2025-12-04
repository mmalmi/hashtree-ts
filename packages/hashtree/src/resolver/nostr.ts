/**
 * NostrRefResolver - Maps npub/treename keys to merkle root hashes (refs)
 *
 * Key format: "npub1.../treename"
 *
 * This resolver provides direct callback subscriptions that bypass React's
 * render cycle. Components can subscribe to hash changes and update directly
 * (e.g., MediaSource append) without triggering re-renders.
 */
import type { RefResolver, Hash, RefResolverListEntry, SubscribeVisibilityInfo } from '../types.js';
import { fromHex, toHex } from '../types.js';

// Nostr event structure (minimal)
export interface NostrEvent {
  id?: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

// Type definitions for nip19
export interface Nip19Like {
  decode(str: string): { type: string; data: unknown };
  npubEncode(pubkey: string): string;
}

// Filter for querying events
export interface NostrFilter {
  kinds?: number[];
  authors?: string[];
  '#d'?: string[];
  '#l'?: string[];
}

// Subscription entry
interface SubscriptionEntry {
  unsubscribe: () => void;
  callbacks: Set<(hash: Hash | null, key?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void>;
  currentHash: string | null;
  currentKey: string | null;
  currentVisibility: SubscribeVisibilityInfo | null;
  latestCreatedAt: number;
}

import type { TreeVisibility } from '../visibility.js';

/**
 * Parsed visibility info from a nostr event
 */
export interface ParsedTreeVisibility {
  hash: string;
  visibility: TreeVisibility;
  /** Plaintext key (for public trees) */
  key?: string;
  /** Encrypted key (for unlisted trees) - decrypt with link key */
  encryptedKey?: string;
  /** Key ID (for unlisted trees) - identifies which link key to use */
  keyId?: string;
  /** Self-encrypted key (for private trees) - decrypt with NIP-04 */
  selfEncryptedKey?: string;
}

/**
 * Parse hash and visibility info from a nostr event
 * Supports all visibility levels: public, unlisted, private
 */
function parseHashAndVisibility(event: NostrEvent): ParsedTreeVisibility | null {
  const hashTag = event.tags.find(t => t[0] === 'hash')?.[1];
  if (!hashTag) return null;

  const key = event.tags.find(t => t[0] === 'key')?.[1];
  const encryptedKey = event.tags.find(t => t[0] === 'encryptedKey')?.[1];
  const keyId = event.tags.find(t => t[0] === 'keyId')?.[1];
  const selfEncryptedKey = event.tags.find(t => t[0] === 'selfEncryptedKey')?.[1];

  let visibility: TreeVisibility;
  if (encryptedKey) {
    // encryptedKey means unlisted (shareable via link)
    // May also have selfEncryptedKey for owner access
    visibility = 'unlisted';
  } else if (selfEncryptedKey) {
    // Only selfEncryptedKey (no encryptedKey) means private
    visibility = 'private';
  } else {
    visibility = 'public';
  }

  return { hash: hashTag, visibility, key, encryptedKey, keyId, selfEncryptedKey };
}

/**
 * Legacy parse function for backwards compatibility
 * @deprecated Use parseHashAndVisibility instead
 */
function parseHashAndKey(event: NostrEvent): { hash: string; key?: string } | null {
  const result = parseHashAndVisibility(event);
  if (!result) return null;
  return { hash: result.hash, key: result.key };
}

export interface NostrRefResolverConfig {
  /** Subscribe to nostr events - returns unsubscribe function */
  subscribe: (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => () => void;
  /** Publish a nostr event - returns true on success */
  publish: (event: Omit<NostrEvent, 'id' | 'pubkey' | 'created_at'>) => Promise<boolean>;
  /** Get current user's pubkey (for ownership checks) */
  getPubkey: () => string | null;
  /** nip19 encode/decode functions from nostr-tools */
  nip19: Nip19Like;
}

/**
 * Create a NostrRefResolver instance
 */
export function createNostrRefResolver(config: NostrRefResolverConfig): RefResolver {
  const { subscribe: nostrSubscribe, publish: nostrPublish, getPubkey, nip19 } = config;

  // Active subscriptions by key
  const subscriptions = new Map<string, SubscriptionEntry>();

  /**
   * Parse a pointer key into pubkey and tree name
   */
  function parseKey(key: string): { pubkey: string; treeName: string } | null {
    const parts = key.split('/');
    if (parts.length !== 2) return null;

    const [npubStr, treeName] = parts;
    try {
      const decoded = nip19.decode(npubStr);
      if (decoded.type !== 'npub') return null;
      return { pubkey: decoded.data as string, treeName };
    } catch {
      return null;
    }
  }

  return {
    /**
     * Resolve a key to its current hash.
     * Waits indefinitely until a hash is found - caller should apply timeout if needed.
     */
    async resolve(key: string): Promise<Hash | null> {
      const parsed = parseKey(key);
      if (!parsed) return null;

      const { pubkey, treeName } = parsed;

      return new Promise((resolve) => {
        let latestHash: string | null = null;
        let latestCreatedAt = 0;

        const unsubscribe = nostrSubscribe(
          {
            kinds: [30078],
            authors: [pubkey],
            '#d': [treeName],
            '#l': ['hashtree'],
          },
          (event) => {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1];
            if (dTag !== treeName) return;

            const hashAndKey = parseHashAndKey(event);
            if (!hashAndKey) return;

            if ((event.created_at || 0) > latestCreatedAt) {
              latestCreatedAt = event.created_at || 0;
              latestHash = hashAndKey.hash;
            }

            // Got a hash, resolve immediately
            if (latestHash) {
              unsubscribe();
              resolve(fromHex(latestHash));
            }
          }
        );
      });
    },

    /**
     * Subscribe to hash changes for a key.
     * Callback fires on each update (including initial value).
     * This runs outside React render cycle.
     */
    subscribe(key: string, callback: (hash: Hash | null, encryptionKey?: Hash, visibilityInfo?: SubscribeVisibilityInfo) => void): () => void {
      const parsed = parseKey(key);
      if (!parsed) {
        callback(null);
        return () => {};
      }

      const { pubkey, treeName } = parsed;

      // Check if we already have a subscription for this key
      let sub = subscriptions.get(key);

      if (sub) {
        // Add callback to existing subscription
        sub.callbacks.add(callback);
        // Fire immediately with current value
        if (sub.currentHash) {
          const keyBytes = sub.currentKey ? fromHex(sub.currentKey) : undefined;
          callback(fromHex(sub.currentHash), keyBytes, sub.currentVisibility ?? undefined);
        }
      } else {
        // Create new subscription
        const unsubscribe = nostrSubscribe(
          {
            kinds: [30078],
            authors: [pubkey],
            '#d': [treeName],
            '#l': ['hashtree'],
          },
          (event) => {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1];
            if (dTag !== treeName) return;

            const subEntry = subscriptions.get(key);
            if (!subEntry) return;

            const visibilityData = parseHashAndVisibility(event);
            if (!visibilityData) return;

            const eventCreatedAt = event.created_at || 0;
            const newHash = visibilityData.hash;
            const newKey = visibilityData.key;

            // Only update if this event is newer
            if (eventCreatedAt >= subEntry.latestCreatedAt && newHash && newHash !== subEntry.currentHash) {
              subEntry.currentHash = newHash;
              subEntry.currentKey = newKey || null;
              subEntry.latestCreatedAt = eventCreatedAt;

              // Build visibility info for callback
              const visibilityInfo: SubscribeVisibilityInfo = {
                visibility: visibilityData.visibility,
                encryptedKey: visibilityData.encryptedKey,
                keyId: visibilityData.keyId,
                selfEncryptedKey: visibilityData.selfEncryptedKey,
              };
              subEntry.currentVisibility = visibilityInfo;

              const hashBytes = fromHex(newHash);
              const keyBytes = newKey ? fromHex(newKey) : undefined;
              // Notify all callbacks
              for (const cb of subEntry.callbacks) {
                try {
                  cb(hashBytes, keyBytes, visibilityInfo);
                } catch (e) {
                  console.error('Resolver callback error:', e);
                }
              }
            }
          }
        );

        sub = {
          unsubscribe,
          callbacks: new Set([callback]),
          currentHash: null,
          currentKey: null,
          currentVisibility: null,
          latestCreatedAt: 0,
        };
        subscriptions.set(key, sub);
      }

      // Return unsubscribe function
      return () => {
        const subEntry = subscriptions.get(key);
        if (!subEntry) return;

        subEntry.callbacks.delete(callback);

        // If no more callbacks, close the subscription
        if (subEntry.callbacks.size === 0) {
          subEntry.unsubscribe();
          subscriptions.delete(key);
        }
      };
    },

    /**
     * Publish/update a pointer
     * @param key - The key to publish to
     * @param hash - The hash to publish
     * @param encryptionKey - Optional encryption key for encrypted trees
     */
    async publish(key: string, hash: Hash, encryptionKey?: Hash): Promise<boolean> {
      const parsed = parseKey(key);
      if (!parsed) return false;

      const { treeName } = parsed;
      const pubkey = getPubkey();

      if (!pubkey) return false;

      try {
        const hashHex = toHex(hash);
        const keyHex = encryptionKey ? toHex(encryptionKey) : undefined;

        // Build tags - new format with hash/key in tags
        const tags: string[][] = [
          ['d', treeName],
          ['l', 'hashtree'],
          ['hash', hashHex],
        ];
        if (keyHex) {
          tags.push(['key', keyHex]);
        }

        const success = await nostrPublish({
          kind: 30078,
          content: '', // Empty content in new format
          tags,
        });

        if (success) {
          // Update local subscription state immediately
          const sub = subscriptions.get(key);
          if (sub) {
            sub.currentHash = hashHex;
            sub.currentKey = keyHex || null;
            sub.latestCreatedAt = Math.floor(Date.now() / 1000);
            const keyBytes = keyHex ? fromHex(keyHex) : undefined;
            // Notify callbacks
            for (const cb of sub.callbacks) {
              try {
                cb(hash, keyBytes);
              } catch (e) {
                console.error('Resolver callback error:', e);
              }
            }
          }
        }

        return success;
      } catch (e) {
        console.error('Failed to publish:', e);
        return false;
      }
    },

    /**
     * List all trees for a user.
     * Streams results as they arrive - returns unsubscribe function.
     * Caller decides when to stop listening.
     */
    list(prefix: string, callback: (entries: RefResolverListEntry[]) => void): () => void {
      const parts = prefix.split('/');
      if (parts.length === 0) {
        callback([]);
        return () => {};
      }

      const npubStr = parts[0];
      let pubkey: string;

      try {
        const decoded = nip19.decode(npubStr);
        if (decoded.type !== 'npub') {
          callback([]);
          return () => {};
        }
        pubkey = decoded.data as string;
      } catch {
        callback([]);
        return () => {};
      }

      // Track entries by d-tag with full visibility info
      const entriesByDTag = new Map<string, ParsedTreeVisibility & { created_at: number }>();

      const emitCurrentState = () => {
        const result: RefResolverListEntry[] = [];
        for (const [dTag, entry] of entriesByDTag) {
          result.push({
            key: `${npubStr}/${dTag}`,
            hash: fromHex(entry.hash),
            // Legacy field for backwards compatibility
            encryptionKey: entry.key ? fromHex(entry.key) : undefined,
            // New visibility fields
            visibility: entry.visibility,
            encryptedKey: entry.encryptedKey,
            keyId: entry.keyId,
            selfEncryptedKey: entry.selfEncryptedKey,
          });
        }
        callback(result);
      };

      const unsubscribe = nostrSubscribe(
        {
          kinds: [30078],
          authors: [pubkey],
          '#l': ['hashtree'],
        },
        (event) => {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1];
          if (!dTag) return;

          const parsed = parseHashAndVisibility(event);
          if (!parsed) return;

          const existing = entriesByDTag.get(dTag);
          if (!existing || (event.created_at || 0) > existing.created_at) {
            entriesByDTag.set(dTag, {
              ...parsed,
              created_at: event.created_at || 0,
            });
            emitCurrentState();
          }
        }
      );

      return unsubscribe;
    },

    /**
     * Stop all subscriptions
     */
    stop(): void {
      for (const [, sub] of subscriptions) {
        sub.unsubscribe();
      }
      subscriptions.clear();
    },
  };
}
