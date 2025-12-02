/**
 * Actions - file and directory operations using HashTree
 */
import { navigate } from './utils/navigate';
import { parseRoute } from './utils/route';
import { toHex, verifyTree } from 'hashtree';
import type { Hash } from 'hashtree';
import { autosaveIfOwn, useNostrStore } from './nostr';
import {
  idbStore,
  getTree,
  useAppStore,
} from './store';

// Build route URL
function buildRouteUrl(npub: string | null, treeName: string | null, path: string[], fileName?: string): string {
  const parts: string[] = [];

  if (npub && treeName) {
    parts.push(npub, treeName);
  }

  parts.push(...path);

  if (fileName) {
    parts.push(fileName);
  }

  return '/' + parts.map(encodeURIComponent).join('/');
}

// Get current directory path from URL (excludes file if selected)
function getCurrentPathFromUrl(): string[] {
  const route = parseRoute();
  const urlPath = route.path;
  if (urlPath.length === 0) return [];

  // Check if last segment looks like a file (has extension)
  const lastSegment = urlPath[urlPath.length - 1];
  const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(lastSegment);
  return looksLikeFile ? urlPath.slice(0, -1) : urlPath;
}

// Update URL to reflect current state
function updateRoute(fileName?: string, options?: { edit?: boolean }) {
  const route = parseRoute();
  const currentPath = getCurrentPathFromUrl();
  let url = buildRouteUrl(route.npub, route.treeName, currentPath, fileName);
  if (options?.edit) {
    url += '?edit=1';
  }
  navigate(url);
}

// Clear file selection (navigate to current directory without file)
export function clearFileSelection() {
  updateRoute();
}

// Navigate to directory
export function navigateTo(_hash: Hash, name?: string) {
  if (name) {
    const route = parseRoute();
    const currentPath = getCurrentPathFromUrl();
    const newPath = [...currentPath, name];
    const url = buildRouteUrl(route.npub, route.treeName, newPath);
    navigate(url);
  }
}

// Go back in path
export function goBack() {
  const currentPath = getCurrentPathFromUrl();
  if (currentPath.length === 0) return;

  const newPath = currentPath.slice(0, -1);
  const route = parseRoute();
  const url = buildRouteUrl(route.npub, route.treeName, newPath);
  navigate(url);
}

// Select file for viewing
export function selectFile(entry: { name: string; isTree: boolean } | null) {
  if (!entry || entry.isTree) return;
  updateRoute(entry.name);
}

// Save edited file
export async function saveFile(entryName: string | undefined, content: string): Promise<Uint8Array | null> {
  if (!entryName) return null;

  const state = useAppStore.getState();
  if (!state.rootHash) return null;

  const tree = getTree();
  const data = new TextEncoder().encode(content);
  const { hash, size } = await tree.putFile(data);
  const currentPath = getCurrentPathFromUrl();

  const newRoot = await tree.setEntry(state.rootHash, currentPath, entryName, hash, size);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  return data;
}

// Create new file
export async function createFile(name: string, content: string = '') {
  if (!name) return;

  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const tree = getTree();
  const data = new TextEncoder().encode(content);
  const { hash, size } = await tree.putFile(data);
  const currentPath = getCurrentPathFromUrl();

  const newRoot = await tree.setEntry(state.rootHash, currentPath, name, hash, size);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Navigate to the newly created file with edit mode
  updateRoute(name, { edit: true });
}

// Create new folder
export async function createFolder(name: string) {
  if (!name) return;

  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const tree = getTree();
  const emptyDirHash = await tree.putDirectory([]);
  const currentPath = getCurrentPathFromUrl();

  const newRoot = await tree.setEntry(state.rootHash, currentPath, name, emptyDirHash, 0, true);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));
}

// Rename entry
export async function renameEntry(oldName: string, newName: string) {
  if (!newName || oldName === newName) return;

  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const tree = getTree();
  const route = parseRoute();
  const urlPath = route.path;

  // Check if we're renaming the current directory (we're inside it)
  const lastSegment = urlPath.length > 0 ? urlPath[urlPath.length - 1] : null;
  const isRenamingCurrentDir = lastSegment === oldName && !/\.[a-zA-Z0-9]+$/.test(oldName);

  let parentPath: string[];
  if (isRenamingCurrentDir) {
    // Renaming current directory - parent is everything except last segment
    parentPath = urlPath.slice(0, -1);
  } else {
    // Renaming item within current directory
    parentPath = getCurrentPathFromUrl();
  }

  const newRoot = await tree.renameEntry(state.rootHash, parentPath, oldName, newName);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Update URL if renamed file/dir was selected or we're inside it
  if (isRenamingCurrentDir) {
    // Navigate to the renamed directory
    const newPath = [...parentPath, newName];
    const url = buildRouteUrl(route.npub, route.treeName, newPath);
    navigate(url);
  } else if (lastSegment === oldName) {
    updateRoute(newName);
  }
}

// Delete entry
export async function deleteEntry(name: string) {
  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  const newRoot = await tree.removeEntry(state.rootHash, currentPath, name);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Navigate to directory if deleted file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === name) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath);
    navigate(url);
  }
}

// Delete current folder (must be in a subdirectory)
export async function deleteCurrentFolder() {
  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const route = parseRoute();
  if (route.path.length === 0) return; // Can't delete root

  const folderName = route.path[route.path.length - 1];
  const parentPath = route.path.slice(0, -1);

  const tree = getTree();
  const newRoot = await tree.removeEntry(state.rootHash, parentPath, folderName);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Navigate to parent directory
  const url = buildRouteUrl(route.npub, route.treeName, parentPath);
  navigate(url);
}

// Move entry into a directory
export async function moveEntry(sourceName: string, targetDirName: string) {
  const state = useAppStore.getState();
  if (!state.rootHash) return;
  if (sourceName === targetDirName) return;

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  // Resolve target directory hash from tree
  const targetPath = [...currentPath, targetDirName].join('/');
  const targetHash = await tree.resolvePath(state.rootHash, targetPath);
  if (!targetHash) return;

  // Check target is a directory
  if (!await tree.isDirectory(targetHash)) return;

  // Check for name collision
  const targetContents = await tree.listDirectory(targetHash);
  if (targetContents.some(e => e.name === sourceName)) {
    alert(`A file named "${sourceName}" already exists in "${targetDirName}"`);
    return;
  }

  const newRoot = await tree.moveEntry(state.rootHash, currentPath, sourceName, [...currentPath, targetDirName]);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Clear selection if moved file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === sourceName) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath);
    navigate(url);
  }
}

// Move entry to parent directory
export async function moveToParent(sourceName: string) {
  const state = useAppStore.getState();
  if (!state.rootHash) return;

  const currentPath = getCurrentPathFromUrl();
  if (currentPath.length === 0) return; // Already at root

  const tree = getTree();
  const parentPath = currentPath.slice(0, -1);

  // Check for name collision in parent
  const parentHash = parentPath.length === 0 ? state.rootHash : await tree.resolvePath(state.rootHash, parentPath.join('/'));
  if (!parentHash) return;

  const parentEntries = await tree.listDirectory(parentHash);
  if (parentEntries.some(e => e.name === sourceName)) {
    alert(`A file named "${sourceName}" already exists in the parent directory`);
    return;
  }

  const newRoot = await tree.moveEntry(state.rootHash, currentPath, sourceName, parentPath);
  state.setRootHash(newRoot);
  await autosaveIfOwn(toHex(newRoot));

  // Clear selection if moved file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === sourceName) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath);
    navigate(url);
  }
}

// Verify tree
export async function verifyCurrentTree(): Promise<{ valid: boolean; missing: number }> {
  const state = useAppStore.getState();
  if (!state.rootHash) return { valid: false, missing: 0 };

  const { valid, missing } = await verifyTree(idbStore, state.rootHash);
  return { valid, missing: missing.length };
}

// Clear store
export function clearStore() {
  idbStore.clear();
  useAppStore.getState().setRootHash(null);
  navigate('/');
}

// Fork a directory as a new top-level tree
export async function forkTree(dirHash: Hash, name: string): Promise<boolean> {
  if (!name) return false;

  const { saveHashtree } = await import('./nostr');
  const rootHex = toHex(dirHash);

  const nostrState = useNostrStore.getState();
  const appState = useAppStore.getState();

  if (!nostrState.npub || !nostrState.pubkey) return false;

  useNostrStore.getState().setSelectedTree({
    id: '',
    name,
    pubkey: nostrState.pubkey,
    rootHash: rootHex,
    created_at: Math.floor(Date.now() / 1000),
  });

  appState.setRootHash(dirHash);

  const success = await saveHashtree(name, rootHex);
  if (success) {
    navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}`);
  }
  return success;
}

// Create a new tree (top-level folder on nostr or local)
export async function createTree(name: string): Promise<boolean> {
  if (!name) return false;

  const { saveHashtree } = await import('./nostr');

  const tree = getTree();
  const hash = await tree.putDirectory([]);
  const rootHex = toHex(hash);

  const nostrState = useNostrStore.getState();
  const appState = useAppStore.getState();

  // If logged in, publish to nostr
  if (nostrState.isLoggedIn && nostrState.npub && nostrState.pubkey) {
    // Set selectedTree BEFORE saving so updates work
    useNostrStore.getState().setSelectedTree({
      id: '', // Will be set by actual nostr event
      name,
      pubkey: nostrState.pubkey,
      rootHash: rootHex,
      created_at: Math.floor(Date.now() / 1000),
    });

    // Also set app state immediately so UI shows the tree
    appState.setRootHash(hash);

    const success = await saveHashtree(name, rootHex);
    if (success) {
      navigate(`/${encodeURIComponent(nostrState.npub)}/${encodeURIComponent(name)}`);
    }
    return success;
  }

  // Not logged in - work locally
  appState.setRootHash(hash);
  navigate('/');
  return true;
}
