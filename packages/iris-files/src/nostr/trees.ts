/**
 * Tree Publishing and Management
 */
import { nip19, nip44 } from 'nostr-tools';
import { NDKEvent } from 'ndk';
import {
  toHex,
  fromHex,
  cid,
  type CID,
  type TreeVisibility,
  visibilityHex,
} from 'hashtree';
import { ndk } from './ndk';
import { nostrStore } from './store';
import { getSecretKey } from './auth';
import { updateLocalRootCacheHex } from '../treeRootCache';
import { parseRoute } from '../utils/route';

// Re-export visibility hex helpers from hashtree lib
export { visibilityHex as linkKeyUtils } from 'hashtree';

export interface SaveHashtreeOptions {
  visibility?: TreeVisibility;
  /** Link key for link-visible trees - if not provided, one will be generated */
  linkKey?: string;
  /** Additional l-tags to add (e.g., ['docs'] for document trees) */
  labels?: string[];
}

/**
 * Parse visibility from Nostr event tags
 */
export function parseVisibility(tags: string[][]): { visibility: TreeVisibility; rootKey?: string; encryptedKey?: string; keyId?: string; selfEncryptedKey?: string } {
  const rootKey = tags.find(t => t[0] === 'key')?.[1];
  const encryptedKey = tags.find(t => t[0] === 'encryptedKey')?.[1];
  const keyId = tags.find(t => t[0] === 'keyId')?.[1];
  const selfEncryptedKey = tags.find(t => t[0] === 'selfEncryptedKey')?.[1];

  let visibility: TreeVisibility;
  if (selfEncryptedKey) {
    visibility = 'private';
  } else if (encryptedKey) {
    visibility = 'link-visible';
  } else {
    visibility = 'public';
  }

  return { visibility, rootKey, encryptedKey, keyId, selfEncryptedKey };
}

/**
 * Save/publish hashtree to relays
 * @param name - Tree name
 * @param rootHash - Root hash (hex encoded)
 * @param rootKey - Decryption key (hex encoded, optional for encrypted trees)
 * @param options - Visibility options
 * @returns Object with success status and linkKey (for link-visible trees)
 */
export async function saveHashtree(
  name: string,
  rootHash: string,
  rootKey?: string,
  options: SaveHashtreeOptions = {}
): Promise<{ success: boolean; linkKey?: string }> {
  const state = nostrStore.getState();
  if (!state.pubkey || !ndk.signer) return { success: false };

  const visibility = options.visibility ?? 'public';
  const secretKey = getSecretKey();

  // Set created_at now (before any async work) so all events from this save have same timestamp
  const now = Math.floor(Date.now() / 1000);

  const event = new NDKEvent(ndk);
  event.kind = 30078;
  event.content = '';
  event.created_at = now;
  event.tags = [
    ['d', name],
    ['l', 'hashtree'],
    ['hash', rootHash],
  ];

  // Add directory prefix labels for discoverability
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    event.tags.push(['l', prefix]);
  }

  // Add extra labels if provided
  if (options.labels) {
    for (const label of options.labels) {
      event.tags.push(['l', label]);
    }
  }

  let linkKey: string | undefined;

  if (rootKey) {
    switch (visibility) {
      case 'public':
        // Plaintext key - anyone can access
        event.tags.push(['key', rootKey]);
        break;

      case 'link-visible':
        // Encrypt key with link key for sharing - do async work in background
        linkKey = options.linkKey ?? visibilityHex.generateLinkKey();
        (async () => {
          const encryptedKey = await visibilityHex.encryptKeyForLink(rootKey, linkKey!);
          const keyId = await visibilityHex.computeKeyId(linkKey!);
          event.tags.push(['encryptedKey', encryptedKey]);
          event.tags.push(['keyId', keyId]);
          // Also self-encrypt so owner can always access without link key
          const conversationKey = nip44.v2.utils.getConversationKey(secretKey!, state.pubkey!);
          const selfEncryptedLinkVisible = nip44.v2.encrypt(rootKey, conversationKey);
          event.tags.push(['selfEncryptedKey', selfEncryptedLinkVisible]);
          try {
            await event.sign();
            if (ndk.cacheAdapter?.setEvent) {
              await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey!], '#d': [name] }]);
            }
          } catch (e) {
            console.error('Failed to sign/cache hashtree:', e);
          }
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;

      case 'private':
        // Encrypt key to self using NIP-44 - do async work in background
        (async () => {
          const conversationKey = nip44.v2.utils.getConversationKey(secretKey!, state.pubkey!);
          const selfEncrypted = nip44.v2.encrypt(rootKey, conversationKey);
          event.tags.push(['selfEncryptedKey', selfEncrypted]);
          try {
            await event.sign();
            if (ndk.cacheAdapter?.setEvent) {
              await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey!], '#d': [name] }]);
            }
          } catch (e) {
            console.error('Failed to sign/cache hashtree:', e);
          }
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;
    }
  }

  // For public visibility, publish immediately (no encryption needed)
  if (!rootKey || visibility === 'public') {
    (async () => {
      try {
        await event.sign();
        if (ndk.cacheAdapter?.setEvent) {
          await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey], '#d': [name] }]);
        }
        event.publish().catch(e => console.error('Failed to publish hashtree:', e));
      } catch (e) {
        console.error('Failed to sign/cache hashtree:', e);
      }
    })();
  }

  // Update selectedTree if it matches
  const currentSelected = state.selectedTree;
  if (currentSelected && currentSelected.name === name && currentSelected.pubkey === state.pubkey) {
    nostrStore.setSelectedTree({
      ...currentSelected,
      rootHash,
      rootKey: visibility === 'public' ? rootKey : undefined,
      visibility,
      created_at: event.created_at || Math.floor(Date.now() / 1000),
    });
  }

  // Update local cache SYNCHRONOUSLY for instant UI
  const npub = state.npub;
  if (npub) {
    const { getRefResolver } = await import('../refResolver');
    const resolver = getRefResolver();
    const hash = fromHex(rootHash);
    const encryptionKey = rootKey ? fromHex(rootKey) : undefined;
    resolver.publish?.(`${npub}/${name}`, cid(hash, encryptionKey), { visibility }, true);

    // Also update treeRootCache for SW file handler access
    updateLocalRootCacheHex(npub, name, rootHash, rootKey, visibility);
  }

  return { success: true, linkKey };
}

/**
 * Check if the selected tree belongs to the logged-in user
 */
export function isOwnTree(): boolean {
  const state = nostrStore.getState();
  if (!state.isLoggedIn || !state.selectedTree || !state.pubkey) return false;
  return state.selectedTree.pubkey === state.pubkey;
}

/**
 * Autosave current tree if it's our own.
 * Updates local cache immediately, publishing is throttled.
 * @param rootCid - Root CID (contains hash and optional encryption key)
 */
export function autosaveIfOwn(rootCid: CID): void {
  const state = nostrStore.getState();
  if (!isOwnTree() || !state.selectedTree || !state.npub) {
    return;
  }

  const rootHash = toHex(rootCid.hash);
  const rootKey = rootCid.key ? toHex(rootCid.key) : undefined;

  // Update local cache - this triggers throttled publish to Nostr
  updateLocalRootCacheHex(state.npub, state.selectedTree.name, rootHash, rootKey);

  // Update selectedTree state immediately for UI
  nostrStore.setSelectedTree({
    ...state.selectedTree,
    rootHash,
    rootKey: state.selectedTree.visibility === 'public' ? rootKey : state.selectedTree.rootKey,
  });
}

/**
 * Publish tree root to Nostr (called by treeRootCache after throttle)
 * This is the ONLY place that should publish merkle roots.
 *
 * @param cachedVisibility - Visibility from the root cache. Use this first, then fall back to selectedTree.
 */
export async function publishTreeRoot(treeName: string, rootHash: string, rootKey?: string, cachedVisibility?: TreeVisibility): Promise<boolean> {
  const state = nostrStore.getState();
  if (!state.pubkey || !ndk.signer) return false;

  // Priority: cached visibility > selectedTree visibility > 'public'
  let visibility: TreeVisibility = cachedVisibility ?? 'public';
  let linkKey: string | undefined;

  // If no cached visibility, try to get from selectedTree
  if (!cachedVisibility) {
    const isOwnSelectedTree = state.selectedTree?.name === treeName &&
      state.selectedTree?.pubkey === state.pubkey;
    if (isOwnSelectedTree && state.selectedTree?.visibility) {
      visibility = state.selectedTree.visibility;
    }
  }

  // For link-visible trees, get the linkKey from the URL
  if (visibility === 'link-visible') {
    const route = parseRoute();
    linkKey = route.params.get('k') ?? undefined;
  }

  const result = await saveHashtree(treeName, rootHash, rootKey, {
    visibility,
    linkKey,
  });

  return result.success;
}

/**
 * Delete a tree (publishes event without hash to nullify)
 * Tree will disappear from listings but can be re-created with same name
 */
export async function deleteTree(treeName: string): Promise<boolean> {
  const state = nostrStore.getState();
  if (!state.npub) return false;

  // Cancel any pending throttled publish - this is critical!
  const { cancelPendingPublish } = await import('../treeRootCache');
  cancelPendingPublish(state.npub, treeName);

  // Remove from recents store
  const { removeRecentByTreeName } = await import('../stores/recents');
  removeRecentByTreeName(state.npub, treeName);

  const { getRefResolver } = await import('../refResolver');
  const resolver = getRefResolver();

  const key = `${state.npub}/${treeName}`;
  return resolver.delete?.(key) ?? false;
}

/**
 * Get npub from pubkey
 */
export function pubkeyToNpub(pk: string): string {
  return nip19.npubEncode(pk);
}

/**
 * Get pubkey from npub
 */
export function npubToPubkey(npubStr: string): string | null {
  try {
    const decoded = nip19.decode(npubStr);
    if (decoded.type !== 'npub') return null;
    return decoded.data as string;
  } catch {
    return null;
  }
}
