/**
 * NostrRefResolver - Maps npub/treename keys to merkle root hashes (refs)
 *
 * Key format: "npub1.../treename"
 *
 * This resolver provides direct callback subscriptions that bypass React's
 * render cycle. Components can subscribe to hash changes and update directly
 * (e.g., MediaSource append) without triggering re-renders.
 */
import type { RefResolver, CID, RefResolverListEntry, SubscribeVisibilityInfo } from '../types.js';
import { fromHex, toHex, cid } from '../types.js';

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
  callbacks: Set<(cid: CID | null, visibilityInfo?: SubscribeVisibilityInfo) => void>;
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

  // Active list subscriptions by npub prefix
  interface ListSubscriptionEntry {
    npub: string;
    entriesByDTag: Map<string, ParsedTreeVisibility & { created_at: number }>;
    callback: (entries: RefResolverListEntry[]) => void;
    unsubscribe: () => void;
  }
  const listSubscriptions = new Map<string, ListSubscriptionEntry>();

  // Persistent local cache for list entries (survives subscription lifecycle)
  // Key is npub, value is map of tree name -> entry
  const localListCache = new Map<string, Map<string, ParsedTreeVisibility & { created_at: number }>>();

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
     * Resolve a key to its current CID.
     * Waits indefinitely until found - caller should apply timeout if needed.
     */
    async resolve(key: string): Promise<CID | null> {
      const parsed = parseKey(key);
      if (!parsed) return null;

      const { pubkey, treeName } = parsed;

      return new Promise((resolve) => {
        let latestData: { hash: string; key?: string } | null = null;
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
              latestData = hashAndKey;
            }

            // Got data, resolve immediately
            if (latestData) {
              unsubscribe();
              resolve(cid(fromHex(latestData.hash), latestData.key ? fromHex(latestData.key) : undefined));
            }
          }
        );
      });
    },

    /**
     * Subscribe to CID changes for a key.
     * Callback fires on each update (including initial value).
     * This runs outside React render cycle.
     */
    subscribe(key: string, callback: (cid: CID | null, visibilityInfo?: SubscribeVisibilityInfo) => void): () => void {
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
          callback(cid(fromHex(sub.currentHash), keyBytes), sub.currentVisibility ?? undefined);
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

              const keyBytes = newKey ? fromHex(newKey) : undefined;
              // Notify all callbacks with CID
              for (const cb of subEntry.callbacks) {
                try {
                  cb(cid(fromHex(newHash), keyBytes), visibilityInfo);
                } catch (e) {
                  console.error('Resolver callback error:', e);
                }
              }
            }
          }
        );

        // Check localListCache for initial values (from recent publish calls)
        const npubStr = key.split('/')[0];
        const cachedEntry = localListCache.get(npubStr)?.get(treeName);

        sub = {
          unsubscribe,
          callbacks: new Set([callback]),
          currentHash: cachedEntry?.hash ?? null,
          currentKey: cachedEntry?.key ?? null,
          currentVisibility: cachedEntry ? {
            visibility: cachedEntry.visibility,
            encryptedKey: cachedEntry.encryptedKey,
            keyId: cachedEntry.keyId,
            selfEncryptedKey: cachedEntry.selfEncryptedKey,
          } : null,
          latestCreatedAt: cachedEntry?.created_at ?? 0,
        };
        subscriptions.set(key, sub);

        // Fire callback immediately with cached value if available
        if (cachedEntry?.hash) {
          const keyBytes = cachedEntry.key ? fromHex(cachedEntry.key) : undefined;
          callback(cid(fromHex(cachedEntry.hash), keyBytes), sub.currentVisibility ?? undefined);
        }
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
     * Updates local cache immediately (optimistic), then fire-and-forget to network.
     * @param key - The key to publish to
     * @param rootCid - The CID to publish
     * @param visibilityInfo - Optional visibility info for list subscriptions
     */
    async publish(key: string, rootCid: CID, visibilityInfo?: SubscribeVisibilityInfo, skipNostrPublish = false): Promise<boolean> {
      const parsed = parseKey(key);
      if (!parsed) return false;

      const { treeName } = parsed;
      const pubkey = getPubkey();

      if (!pubkey) return false;

      const hashHex = toHex(rootCid.hash);
      const keyHex = rootCid.key ? toHex(rootCid.key) : undefined;
      const now = Math.floor(Date.now() / 1000);
      const npubStr = key.split('/')[0];

      // 1. Update local caches FIRST (optimistic update for instant UI)

      // Update local list cache (persists even without active subscription)
      let npubCache = localListCache.get(npubStr);
      if (!npubCache) {
        npubCache = new Map();
        localListCache.set(npubStr, npubCache);
      }
      npubCache.set(treeName, {
        hash: hashHex,
        visibility: visibilityInfo?.visibility ?? 'public',
        key: keyHex,
        encryptedKey: visibilityInfo?.encryptedKey,
        keyId: visibilityInfo?.keyId,
        selfEncryptedKey: visibilityInfo?.selfEncryptedKey,
        created_at: now,
      });

      // Update active subscription state
      const sub = subscriptions.get(key);
      if (sub) {
        sub.currentHash = hashHex;
        sub.currentKey = keyHex || null;
        sub.latestCreatedAt = now;
        sub.currentVisibility = visibilityInfo ?? null;
        // Notify callbacks with CID
        for (const cb of sub.callbacks) {
          try {
            cb(rootCid, visibilityInfo);
          } catch (e) {
            console.error('Resolver callback error:', e);
          }
        }
      }

      // Update active list subscriptions
      const listSub = listSubscriptions.get(npubStr);
      if (listSub) {
        listSub.entriesByDTag.set(treeName, {
          hash: hashHex,
          visibility: visibilityInfo?.visibility ?? 'public',
          key: keyHex,
          encryptedKey: visibilityInfo?.encryptedKey,
          keyId: visibilityInfo?.keyId,
          selfEncryptedKey: visibilityInfo?.selfEncryptedKey,
          created_at: now,
        });
        // Emit updated state immediately
        const result: RefResolverListEntry[] = [];
        for (const [dTag, entry] of listSub.entriesByDTag) {
          result.push({
            key: `${npubStr}/${dTag}`,
            cid: cid(fromHex(entry.hash), entry.key ? fromHex(entry.key) : undefined),
            visibility: entry.visibility,
            encryptedKey: entry.encryptedKey,
            keyId: entry.keyId,
            selfEncryptedKey: entry.selfEncryptedKey,
          });
        }
        listSub.callback(result);
      }

      // 2. Fire-and-forget to network (unless skipped)
      // skipNostrPublish is used when the caller handles Nostr publishing separately
      // (e.g., saveHashtree publishes with full visibility tags)
      if (!skipNostrPublish) {
        const tags: string[][] = [
          ['d', treeName],
          ['l', 'hashtree'],
          ['hash', hashHex],
        ];
        if (keyHex) {
          tags.push(['key', keyHex]);
        }

        nostrPublish({
          kind: 30078,
          content: '',
          tags,
        }).catch(e => console.error('Failed to publish to nostr:', e));
      }

      return true; // Optimistic - local cache updated
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

      // Pre-populate from local cache (for instant display of locally-created trees)
      const cachedEntries = localListCache.get(npubStr);
      if (cachedEntries) {
        for (const [treeName, entry] of cachedEntries) {
          entriesByDTag.set(treeName, entry);
        }
      }

      const emitCurrentState = () => {
        const result: RefResolverListEntry[] = [];
        for (const [dTag, entry] of entriesByDTag) {
          result.push({
            key: `${npubStr}/${dTag}`,
            cid: cid(fromHex(entry.hash), entry.key ? fromHex(entry.key) : undefined),
            visibility: entry.visibility,
            encryptedKey: entry.encryptedKey,
            keyId: entry.keyId,
            selfEncryptedKey: entry.selfEncryptedKey,
          });
        }
        callback(result);
      };

      // Emit cached entries immediately if any
      if (entriesByDTag.size > 0) {
        emitCurrentState();
      }

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
          const eventTime = event.created_at || 0;


          // Only update if this event is strictly newer than existing
          // If same timestamp, prefer existing (local cache has full visibility info)
          if (!existing || eventTime > existing.created_at) {
            entriesByDTag.set(dTag, {
              ...parsed,
              created_at: eventTime,
            });
            emitCurrentState();
          }
        }
      );

      // Register this list subscription so publish() can update it immediately
      listSubscriptions.set(npubStr, {
        npub: npubStr,
        entriesByDTag,
        callback,
        unsubscribe,
      });

      return () => {
        unsubscribe();
        listSubscriptions.delete(npubStr);
      };
    },

    /**
     * Stop all subscriptions
     */
    stop(): void {
      for (const [, sub] of subscriptions) {
        sub.unsubscribe();
      }
      subscriptions.clear();
      listSubscriptions.clear();
    },

    /**
     * Inject a local list entry (for instant UI updates)
     * This updates the local cache to make trees appear immediately.
     */
    injectListEntry(entry: RefResolverListEntry): void {
      const parts = entry.key.split('/');
      if (parts.length !== 2) return;
      const [npubStr, treeName] = parts;

      const now = Math.floor(Date.now() / 1000);

      // Update the local list cache
      let npubCache = localListCache.get(npubStr);
      if (!npubCache) {
        npubCache = new Map();
        localListCache.set(npubStr, npubCache);
      }

      const existing = npubCache.get(treeName);
      if (!existing || now >= existing.created_at) {
        npubCache.set(treeName, {
          hash: toHex(entry.cid.hash),
          visibility: entry.visibility ?? 'public',
          key: entry.cid.key ? toHex(entry.cid.key) : undefined,
          encryptedKey: entry.encryptedKey,
          keyId: entry.keyId,
          selfEncryptedKey: entry.selfEncryptedKey,
          created_at: now,
        });
      }

      // If there's an active list subscription for this npub, update it too
      const listSub = listSubscriptions.get(npubStr);
      if (listSub) {
        const existingSub = listSub.entriesByDTag.get(treeName);
        if (!existingSub || now >= existingSub.created_at) {
          listSub.entriesByDTag.set(treeName, {
            hash: toHex(entry.cid.hash),
            visibility: entry.visibility ?? 'public',
            key: entry.cid.key ? toHex(entry.cid.key) : undefined,
            encryptedKey: entry.encryptedKey,
            keyId: entry.keyId,
            selfEncryptedKey: entry.selfEncryptedKey,
            created_at: now,
          });
          // Emit updated state
          const result: RefResolverListEntry[] = [];
          for (const [dTag, e] of listSub.entriesByDTag) {
            result.push({
              key: `${npubStr}/${dTag}`,
              cid: cid(fromHex(e.hash), e.key ? fromHex(e.key) : undefined),
              visibility: e.visibility,
              encryptedKey: e.encryptedKey,
              keyId: e.keyId,
              selfEncryptedKey: e.selfEncryptedKey,
            });
          }
          listSub.callback(result);
        }
      }
    },
  };
}
