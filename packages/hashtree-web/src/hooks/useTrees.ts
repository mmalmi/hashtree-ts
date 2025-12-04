/**
 * Hook to subscribe to a user's trees via RefResolver
 *
 * Replaces the old loadHashtrees approach with live subscription.
 */
import { useEffect, useState } from 'react';
import { getRefResolver } from '../refResolver';
import { toHex, type Hash, type TreeVisibility } from 'hashtree';
import { useNostrStore } from '../nostr';
import Dexie from 'dexie';

// Dexie database for link keys
class LinkKeysDB extends Dexie {
  linkKeys!: Dexie.Table<{ key: string; linkKey: string }, string>;

  constructor() {
    super('hashtree-link-keys');
    this.version(1).stores({
      linkKeys: 'key', // key = "npub/treeName"
    });
  }
}

const db = new LinkKeysDB();

// In-memory cache for sync access (populated from DB)
let linkKeysCache: Record<string, string> = {};
let cacheLoadPromise: Promise<void> | null = null;

// Load cache from DB
async function loadCache(): Promise<void> {
  if (cacheLoadPromise) return cacheLoadPromise;
  cacheLoadPromise = (async () => {
    try {
      const all = await db.linkKeys.toArray();
      linkKeysCache = Object.fromEntries(all.map(e => [e.key, e.linkKey]));
    } catch {
      // Ignore errors
    }
  })();
  return cacheLoadPromise;
}

// Initialize cache on module load
loadCache();

/**
 * Get stored link keys (sync, from cache)
 */
export function getStoredLinkKeys(): Record<string, string> {
  return linkKeysCache;
}

/**
 * Wait for cache to be loaded
 */
export async function waitForLinkKeysCache(): Promise<void> {
  await loadCache();
}

/**
 * Store a link key for an unlisted tree
 */
export async function storeLinkKey(npub: string, treeName: string, linkKey: string): Promise<void> {
  const key = `${npub}/${treeName}`;
  linkKeysCache[key] = linkKey;
  await db.linkKeys.put({ key, linkKey });
}

/**
 * Get a stored link key for a tree
 */
export function getLinkKey(npub: string, treeName: string): string | null {
  return linkKeysCache[`${npub}/${treeName}`] ?? null;
}

export interface TreeEntry {
  key: string;      // "npub1.../treename"
  name: string;     // Just the tree name
  hash: Hash;       // Current root hash
  hashHex: string;  // Hex string of hash
  /** @deprecated Use visibility instead */
  encryptionKey?: Hash; // Encryption key (if encrypted, public)
  /** Tree visibility: public, unlisted, or private */
  visibility: TreeVisibility;
  /** Encrypted key for unlisted trees */
  encryptedKey?: string;
  /** Key ID for unlisted trees */
  keyId?: string;
  /** Self-encrypted key for private trees */
  selfEncryptedKey?: string;
  /** Link key for unlisted trees (only for own trees, from local storage) */
  linkKey?: string;
}

/**
 * Subscribe to trees for an npub
 * Returns live-updating list of trees
 */
export function useTrees(npub: string | null): TreeEntry[] {
  const [trees, setTrees] = useState<TreeEntry[]>([]);
  const userNpub = useNostrStore(s => s.npub);
  const isOwnTrees = npub === userNpub;

  useEffect(() => {
    if (!npub) {
      setTrees([]);
      return;
    }

    const resolver = getRefResolver();
    if (!resolver.list) {
      return;
    }

    let unsubscribe: (() => void) | undefined;

    // Wait for link keys cache before subscribing
    waitForLinkKeysCache().then(() => {
      unsubscribe = resolver.list!(npub, (entries) => {
        // Read link keys fresh on each callback
        const storedLinkKeys = isOwnTrees ? getStoredLinkKeys() : {};

        setTrees(entries.map(e => {
          const name = e.key.split('/')[1] || '';
          const visibility = e.visibility ?? 'public';
          // Include stored link key for unlisted trees (own trees only)
          const linkKey = visibility === 'unlisted' && isOwnTrees
            ? storedLinkKeys[`${npub}/${name}`]
            : undefined;

          return {
            key: e.key,
            name,
            hash: e.hash,
            hashHex: toHex(e.hash),
            encryptionKey: e.encryptionKey,
            visibility,
            encryptedKey: e.encryptedKey,
            keyId: e.keyId,
            selfEncryptedKey: e.selfEncryptedKey,
            linkKey,
          };
        }));
      });
    });

    return () => unsubscribe?.();
  }, [npub, isOwnTrees]);

  return trees;
}
