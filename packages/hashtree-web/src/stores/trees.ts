/**
 * Hook to subscribe to a user's trees via RefResolver
 *
 * Svelte port - uses Svelte stores instead of React hooks.
 * The link key storage is framework-agnostic.
 */
import { writable, get, type Readable } from 'svelte/store';
import { getRefResolver } from '../refResolver';
import { toHex, type Hash, type TreeVisibility } from 'hashtree';
import { nostrStore } from '../nostr';
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

// Listeners for link key updates
const linkKeyListeners: Set<() => void> = new Set();

/**
 * Subscribe to link key updates
 */
export function onLinkKeyUpdate(callback: () => void): () => void {
  linkKeyListeners.add(callback);
  return () => linkKeyListeners.delete(callback);
}

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
  // Notify listeners that a link key was updated
  linkKeyListeners.forEach(fn => fn());
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
  /** Tree visibility: public, unlisted, or private. Undefined if not yet resolved from Nostr. */
  visibility: TreeVisibility | undefined;
  /** Encrypted key for unlisted trees */
  encryptedKey?: string;
  /** Key ID for unlisted trees */
  keyId?: string;
  /** Self-encrypted key for private trees */
  selfEncryptedKey?: string;
  /** Link key for unlisted trees (only for own trees, from local storage) */
  linkKey?: string;
  /** Unix timestamp when the tree was created/last updated */
  createdAt?: number;
}

/**
 * Create a Svelte store that subscribes to trees for an npub
 * Returns a Readable store with live-updating list of trees
 */
export function createTreesStore(npub: string | null): Readable<TreeEntry[]> {
  const store = writable<TreeEntry[]>([]);

  if (!npub) {
    return { subscribe: store.subscribe };
  }

  const resolver = getRefResolver();
  if (!resolver.list) {
    return { subscribe: store.subscribe };
  }

  // Get current user's npub for comparison
  const userNpub = nostrStore.getState().npub;
  const isOwnTrees = npub === userNpub;

  let unsubscribe: (() => void) | undefined;

  // Wait for link keys cache before subscribing
  waitForLinkKeysCache().then(() => {
    unsubscribe = resolver.list!(npub, (entries) => {
      // Read link keys fresh on each callback
      const storedLinkKeys = isOwnTrees ? getStoredLinkKeys() : {};

      store.set(entries.map(e => {
        const name = e.key.split('/')[1] || '';
        // Don't default visibility - let it be undefined if not resolved from Nostr
        const visibility = e.visibility;
        // Include stored link key for unlisted trees (own trees only)
        const linkKey = visibility === 'unlisted' && isOwnTrees
          ? storedLinkKeys[`${npub}/${name}`]
          : undefined;

        return {
          key: e.key,
          name,
          hash: e.cid.hash,
          hashHex: toHex(e.cid.hash),
          encryptionKey: e.cid.key,
          visibility,
          encryptedKey: e.encryptedKey,
          keyId: e.keyId,
          selfEncryptedKey: e.selfEncryptedKey,
          linkKey,
          createdAt: e.createdAt,
        };
      }));
    });
  });

  return {
    subscribe: (fn: (value: TreeEntry[]) => void) => {
      const unsub = store.subscribe(fn);
      return () => {
        unsub();
        unsubscribe?.();
      };
    }
  };
}

// For backward compatibility with React-style usage in non-component code
export function trees(npub: string | null): TreeEntry[] {
  const store = createTreesStore(npub);
  return get(store);
}
