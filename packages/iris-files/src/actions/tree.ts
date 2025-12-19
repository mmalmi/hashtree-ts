/**
 * Tree operations - create, fork, verify trees
 */
import { navigate } from '../utils/navigate';
import { parseRoute } from '../utils/route';
import { verifyTree, toHex, LinkType } from 'hashtree';
import type { CID } from 'hashtree';
import { saveHashtree, useNostrStore } from '../nostr';
import { nip19 } from 'nostr-tools';
import { localStore, getTree } from '../store';
import { autosaveIfOwn } from '../nostr';
import { getCurrentRootCid, getCurrentPathFromUrl } from './route';
import { updateLocalRootCache } from '../treeRootCache';

// Helper to initialize a virtual tree (when rootCid is null but we're in a tree route)
export async function initVirtualTree(entries: { name: string; cid: CID; size: number; type?: LinkType }[]): Promise<CID | null> {
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
    type: e.type,
  }));
  const { cid: newRootCid } = await tree.putDirectory(dirEntries);

  // Save to nostr with key - resolver will pick up the update automatically
  const hashHex = toHex(newRootCid.hash);
  const keyHex = newRootCid.key ? toHex(newRootCid.key) : undefined;

  // Preserve current tree's visibility when updating
  const currentVisibility = nostrStore.selectedTree?.visibility ?? 'public';

  // Update local cache FIRST for immediate UI update (before async nostr publish)
  // Include visibility so throttled publish uses correct tags
  if (nostrStore.npub) {
    updateLocalRootCache(nostrStore.npub, route.treeName, newRootCid.hash, newRootCid.key, currentVisibility);
  }

  useNostrStore.setSelectedTree({
    id: '',
    name: route.treeName,
    pubkey: routePubkey,
    rootHash: hashHex,
    rootKey: keyHex,
    visibility: currentVisibility,
    created_at: Math.floor(Date.now() / 1000),
  });

  // Now publish to Nostr (fire-and-forget for UI responsiveness)
  // Pass visibility to preserve it in the published event
  void saveHashtree(route.treeName, hashHex, keyHex, { visibility: currentVisibility });

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
      LinkType.Dir
    );
    // Publish to nostr - resolver will pick up the update
    autosaveIfOwn(newRootCid);
  } else {
    // Initialize virtual tree with this folder
    await initVirtualTree([{ name, cid: emptyDirCid, size: 0, type: LinkType.Dir }]);
  }
}

// Create new Yjs document folder (folder with .yjs config file)
export async function createDocument(name: string) {
  if (!name) return;

  const rootCid = getCurrentRootCid();
  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  // Create .yjs config file with owner's npub as first editor
  const nostrState = useNostrStore.getState();
  const ownerNpub = nostrState.npub || '';
  const yjsContent = new TextEncoder().encode(ownerNpub ? ownerNpub + '\n' : '');
  const { cid: yjsFileCid, size: yjsFileSize } = await tree.putFile(yjsContent);

  // Create directory with .yjs file inside
  const { cid: docDirCid } = await tree.putDirectory([
    { name: '.yjs', cid: yjsFileCid, size: yjsFileSize, type: LinkType.Blob }
  ]);

  if (rootCid) {
    // Add to existing tree
    const newRootCid = await tree.setEntry(
      rootCid,
      currentPath,
      name,
      docDirCid,
      0,
      LinkType.Dir
    );
    // Publish to nostr
    autosaveIfOwn(newRootCid);

    // Update local cache for subsequent saves (visibility is preserved from selectedTree)
    const route = parseRoute();
    const nostrStore = useNostrStore.getState();
    if (nostrStore.npub && route.treeName) {
      updateLocalRootCache(nostrStore.npub, route.treeName, newRootCid.hash, newRootCid.key, nostrStore.selectedTree?.visibility);
    }
  } else {
    // Initialize virtual tree with this document folder
    await initVirtualTree([{ name, cid: docDirCid, size: 0, type: LinkType.Dir }]);
  }
}

// Fork a directory as a new top-level tree
// Preserves the key if forking from an encrypted tree
export async function forkTree(dirCid: CID, name: string, visibility: import('hashtree').TreeVisibility = 'public'): Promise<{ success: boolean; linkKey?: string }> {
  if (!name) return { success: false };

  const { saveHashtree } = await import('../nostr');
  const { storeLinkKey } = await import('../stores/trees');
  const rootHex = toHex(dirCid.hash);
  const keyHex = dirCid.key ? toHex(dirCid.key) : undefined;

  const nostrState = useNostrStore.getState();

  if (!nostrState.npub || !nostrState.pubkey) return { success: false };

  useNostrStore.setSelectedTree({
    id: '',
    name,
    pubkey: nostrState.pubkey,
    rootHash: rootHex,
    rootKey: visibility === 'public' ? keyHex : undefined,
    visibility,
    created_at: Math.floor(Date.now() / 1000),
  });

  // Update local cache IMMEDIATELY for subsequent operations
  updateLocalRootCache(nostrState.npub, name, dirCid.hash, dirCid.key, visibility);

  // Publish to nostr - resolver will pick up the update when we navigate
  const result = await saveHashtree(name, rootHex, keyHex, { visibility });

  // For unlisted trees, store link key locally and append to URL
  if (result.linkKey) {
    storeLinkKey(nostrState.npub, name, result.linkKey);
  }

  if (result.success) {
    const linkKeyParam = result.linkKey ? `?k=${result.linkKey}` : '';
    navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}${linkKeyParam}`);
  }
  return result;
}

// Create a new tree (top-level folder on nostr or local)
// Creates encrypted trees by default
// Set skipNavigation=true to create without navigating (for batch creation)
export async function createTree(name: string, visibility: import('hashtree').TreeVisibility = 'public', skipNavigation = false): Promise<{ success: boolean; linkKey?: string }> {
  if (!name) return { success: false };

  const { saveHashtree } = await import('../nostr');
  const { storeLinkKey } = await import('../stores/trees');

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
      useNostrStore.setSelectedTree({
        id: '', // Will be set by actual nostr event
        name,
        pubkey: nostrState.pubkey,
        rootHash: rootHex,
        rootKey: visibility === 'public' ? keyHex : undefined,
        visibility,
        created_at: Math.floor(Date.now() / 1000),
      });
    }

    // Update local cache IMMEDIATELY so subsequent operations can find the root
    // This is critical - without this, createFolder called right after createTree
    // would see rootCid as null and create a new tree instead of adding to this one
    // Include visibility for correct throttled publish
    updateLocalRootCache(nostrState.npub, name, rootCid.hash, rootCid.key, visibility);

    // Publish to nostr and update local cache
    // The await ensures local cache is updated before navigation
    const result = await saveHashtree(name, rootHex, keyHex, { visibility });

    // For unlisted trees, store link key locally and append to URL
    if (result.linkKey) {
      storeLinkKey(nostrState.npub, name, result.linkKey);
    }

    if (!skipNavigation) {
      const linkKeyParam = result.linkKey ? `?k=${result.linkKey}` : '';
      navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}${linkKeyParam}`);
    }
    return result;
  }

  // Not logged in - can't create trees without nostr
  return { success: false };
}

// Create a new tree as a document (with .yjs config file)
// Used by docs app to create standalone documents
export async function createDocumentTree(
  name: string,
  visibility: import('hashtree').TreeVisibility = 'public'
): Promise<{ success: boolean; npub?: string; treeName?: string; linkKey?: string }> {
  if (!name) return { success: false };

  const { saveHashtree } = await import('../nostr');
  const { storeLinkKey } = await import('../stores/trees');

  const tree = getTree();
  const nostrState = useNostrStore.getState();

  if (!nostrState.isLoggedIn || !nostrState.npub || !nostrState.pubkey) {
    return { success: false };
  }

  const treeName = `docs/${name}`;

  // Create .yjs config file with owner's npub as first editor
  const yjsContent = new TextEncoder().encode(nostrState.npub + '\n');
  const { cid: yjsFileCid, size: yjsFileSize } = await tree.putFile(yjsContent);

  // Create root directory with .yjs file inside
  const { cid: rootCid } = await tree.putDirectory([
    { name: '.yjs', cid: yjsFileCid, size: yjsFileSize, type: LinkType.Blob }
  ]);

  const rootHex = toHex(rootCid.hash);
  const keyHex = rootCid.key ? toHex(rootCid.key) : undefined;

  // Set selectedTree for updates
  useNostrStore.setSelectedTree({
    id: '',
    name: treeName,
    pubkey: nostrState.pubkey,
    rootHash: rootHex,
    rootKey: visibility === 'public' ? keyHex : undefined,
    visibility,
    created_at: Math.floor(Date.now() / 1000),
  });

  // Update local cache
  updateLocalRootCache(nostrState.npub, treeName, rootCid.hash, rootCid.key, visibility);

  // Publish to nostr with docs label
  const result = await saveHashtree(treeName, rootHex, keyHex, { visibility, labels: ['docs'] });

  // Store link key for unlisted documents
  if (result.linkKey) {
    storeLinkKey(nostrState.npub, treeName, result.linkKey);
  }

  return { success: true, npub: nostrState.npub, treeName, linkKey: result.linkKey };
}

// Verify tree
export async function verifyCurrentTree(): Promise<{ valid: boolean; missing: number }> {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return { valid: false, missing: 0 };

  const { valid, missing } = await verifyTree(localStore, rootCid.hash);
  return { valid, missing: missing.length };
}

// Clear store
export function clearStore() {
  localStore.clear();
  navigate('/');
}
