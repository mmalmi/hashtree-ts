/**
 * Tree operations - create, fork, verify trees
 */
import { navigate } from '../utils/navigate';
import { parseRoute } from '../utils/route';
import { toHex, verifyTree } from 'hashtree';
import type { CID } from 'hashtree';
import { saveHashtree, useNostrStore } from '../nostr';
import { nip19 } from 'nostr-tools';
import { idbStore, getTree } from '../store';
import { autosaveIfOwn } from '../nostr';
import { getCurrentRootCid, getCurrentPathFromUrl } from './route';

// Helper to initialize a virtual tree (when rootCid is null but we're in a tree route)
export async function initVirtualTree(entries: { name: string; cid: CID; size: number; isTree?: boolean }[]): Promise<CID | null> {
  const route = parseRoute();
  if (!route.npub || !route.treeName) return null;

  const tree = getTree();
  const nostrStore = useNostrStore.getState();

  let routePubkey: string;
  try {
    const decoded = nip19.decode(route.npub);
    if (decoded.type !== 'npub') return null;
    routePubkey = decoded.data as string;
  } catch {
    return null;
  }

  const isOwnTree = routePubkey === nostrStore.pubkey;
  if (!isOwnTree) return null; // Can only create in own trees

  // Create new encrypted tree with the entries (using DirEntry format)
  const dirEntries = entries.map(e => ({
    name: e.name,
    cid: e.cid,
    size: e.size,
    isTree: e.isTree,
  }));
  const { cid: newRootCid } = await tree.putDirectory(dirEntries);

  // Save to nostr with key - resolver will pick up the update automatically
  const hashHex = toHex(newRootCid.hash);
  const keyHex = newRootCid.key ? toHex(newRootCid.key) : undefined;
  await saveHashtree(route.treeName, hashHex, keyHex);
  nostrStore.setSelectedTree({
    id: '',
    name: route.treeName,
    pubkey: routePubkey,
    rootHash: hashHex,
    rootKey: keyHex,
    created_at: Math.floor(Date.now() / 1000),
  });

  return newRootCid;
}

// Create new folder
export async function createFolder(name: string) {
  if (!name) return;

  const rootCid = getCurrentRootCid();
  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  // putDirectory returns CID (encrypted by default)
  const { cid: emptyDirCid } = await tree.putDirectory([]);

  if (rootCid) {
    // Add to existing tree
    const newRootCid = await tree.setEntry(
      rootCid,
      currentPath,
      name,
      emptyDirCid,
      0,
      true
    );
    // Publish to nostr - resolver will pick up the update
    await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
  } else {
    // Initialize virtual tree with this folder
    await initVirtualTree([{ name, cid: emptyDirCid, size: 0, isTree: true }]);
  }
}

// Fork a directory as a new top-level tree
// Preserves the key if forking from an encrypted tree
export async function forkTree(dirCid: CID, name: string): Promise<boolean> {
  if (!name) return false;

  const { saveHashtree } = await import('../nostr');
  const rootHex = toHex(dirCid.hash);
  const keyHex = dirCid.key ? toHex(dirCid.key) : undefined;

  const nostrState = useNostrStore.getState();

  if (!nostrState.npub || !nostrState.pubkey) return false;

  useNostrStore.getState().setSelectedTree({
    id: '',
    name,
    pubkey: nostrState.pubkey,
    rootHash: rootHex,
    rootKey: keyHex,
    created_at: Math.floor(Date.now() / 1000),
  });

  // Publish to nostr - resolver will pick up the update when we navigate
  const success = await saveHashtree(name, rootHex, keyHex);
  if (success) {
    navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}`);
  }
  return success;
}

// Create a new tree (top-level folder on nostr or local)
// Creates encrypted trees by default
// Set skipNavigation=true to create without navigating (for batch creation)
export async function createTree(name: string, visibility: import('hashtree').TreeVisibility = 'public', skipNavigation = false): Promise<{ success: boolean; linkKey?: string }> {
  if (!name) return { success: false };

  const { saveHashtree } = await import('../nostr');

  const tree = getTree();
  // Create encrypted empty directory (default)
  const { cid: rootCid } = await tree.putDirectory([]);
  const rootHex = toHex(rootCid.hash);
  const keyHex = rootCid.key ? toHex(rootCid.key) : undefined;

  const nostrState = useNostrStore.getState();

  // If logged in, publish to nostr
  if (nostrState.isLoggedIn && nostrState.npub && nostrState.pubkey) {
    // Set selectedTree BEFORE saving so updates work (only if we're navigating)
    if (!skipNavigation) {
      useNostrStore.getState().setSelectedTree({
        id: '', // Will be set by actual nostr event
        name,
        pubkey: nostrState.pubkey,
        rootHash: rootHex,
        rootKey: visibility === 'public' ? keyHex : undefined,
        visibility,
        created_at: Math.floor(Date.now() / 1000),
      });
    }

    // Publish to nostr with visibility - resolver will pick up the update when we navigate
    const result = await saveHashtree(name, rootHex, keyHex, { visibility });
    if (result.success) {
      // For unlisted trees, store link key locally and append to URL
      if (result.linkKey) {
        const { storeLinkKey } = await import('../hooks/useTrees');
        await storeLinkKey(nostrState.npub, name, result.linkKey);
      }
      if (!skipNavigation) {
        const linkKeyParam = result.linkKey ? `?k=${result.linkKey}` : '';
        navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}${linkKeyParam}`);
      }
    }
    return result;
  }

  // Not logged in - can't create trees without nostr
  return { success: false };
}

// Verify tree
export async function verifyCurrentTree(): Promise<{ valid: boolean; missing: number }> {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return { valid: false, missing: 0 };

  const { valid, missing } = await verifyTree(idbStore, rootCid.hash);
  return { valid, missing: missing.length };
}

// Clear store
export function clearStore() {
  idbStore.clear();
  navigate('/');
}
