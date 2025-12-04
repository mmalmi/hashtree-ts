/**
 * Actions - file and directory operations using HashTree
 *
 * All operations use encryption by default (CHK - Content Hash Key).
 * The root CID is derived from the URL via the resolver subscription.
 * After modifications, the new root is published to nostr and the resolver
 * automatically picks up the update.
 */
import { navigate } from './utils/navigate';
import { parseRoute } from './utils/route';
import { toHex, verifyTree } from 'hashtree';
import type { Hash, CID } from 'hashtree';
import { autosaveIfOwn, saveHashtree, useNostrStore } from './nostr';
import { nip19 } from 'nostr-tools';
import {
  idbStore,
  getTree,
} from './store';
import { getTreeRootSync } from './hooks/useTreeRoot';
import { markFilesChanged } from './hooks/useRecentlyChanged';

// Helper to get current rootCid from route via resolver cache
function getCurrentRootCid(): CID | null {
  const route = parseRoute();
  return getTreeRootSync(route.npub, route.treeName);
}

// Build route URL, preserving linkKey if present
function buildRouteUrl(npub: string | null, treeName: string | null, path: string[], fileName?: string, linkKey?: string | null): string {
  const parts: string[] = [];

  if (npub && treeName) {
    parts.push(npub, treeName);
  }

  parts.push(...path);

  if (fileName) {
    parts.push(fileName);
  }

  let url = '/' + parts.map(encodeURIComponent).join('/');
  if (linkKey) {
    url += `?k=${linkKey}`;
  }
  return url;
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
  let url = buildRouteUrl(route.npub, route.treeName, currentPath, fileName, route.linkKey);
  if (options?.edit) {
    // Append edit param, preserving existing query string
    url += url.includes('?') ? '&edit=1' : '?edit=1';
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
    const url = buildRouteUrl(route.npub, route.treeName, newPath, undefined, route.linkKey);
    navigate(url);
  }
}

// Go back in path
export function goBack() {
  const currentPath = getCurrentPathFromUrl();
  if (currentPath.length === 0) return;

  const newPath = currentPath.slice(0, -1);
  const route = parseRoute();
  const url = buildRouteUrl(route.npub, route.treeName, newPath, undefined, route.linkKey);
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

  const rootCid = getCurrentRootCid();
  if (!rootCid) return null;

  const tree = getTree();
  const data = new TextEncoder().encode(content);
  const currentPath = getCurrentPathFromUrl();

  // putFile returns CID with key (encrypted by default)
  const { cid: fileCid, size } = await tree.putFile(data);

  // setEntry uses root CID and entry CID - handles encryption automatically
  const newRootCid = await tree.setEntry(
    rootCid,
    currentPath,
    entryName,
    fileCid,
    size
  );

  // Publish to nostr - resolver will pick up the update automatically
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  return data;
}

// Helper to initialize a virtual tree (when rootCid is null but we're in a tree route)
async function initVirtualTree(entries: { name: string; cid: CID; size: number; isTree?: boolean }[]): Promise<CID | null> {
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

// Create new file
export async function createFile(name: string, content: string = '') {
  if (!name) return;

  const rootCid = getCurrentRootCid();
  const tree = getTree();
  const data = new TextEncoder().encode(content);
  const currentPath = getCurrentPathFromUrl();

  // putFile returns CID (encrypted by default)
  const { cid: fileCid, size } = await tree.putFile(data);

  if (rootCid) {
    // Add to existing tree
    const newRootCid = await tree.setEntry(
      rootCid,
      currentPath,
      name,
      fileCid,
      size
    );
    // Publish to nostr - resolver will pick up the update
    await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
  } else {
    // Initialize virtual tree with this file
    const result = await initVirtualTree([{ name, cid: fileCid, size }]);
    if (!result) return; // Failed to initialize
  }

  // Navigate to the newly created file with edit mode
  updateRoute(name, { edit: true });
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

// Rename entry
export async function renameEntry(oldName: string, newName: string) {
  if (!newName || oldName === newName) return;

  const rootCid = getCurrentRootCid();
  if (!rootCid) return;

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

  const newRootCid = await tree.renameEntry(
    rootCid,
    parentPath,
    oldName,
    newName
  );
  // Publish to nostr - resolver will pick up the update
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  // Update URL if renamed file/dir was selected or we're inside it
  if (isRenamingCurrentDir) {
    // Navigate to the renamed directory
    const newPath = [...parentPath, newName];
    const url = buildRouteUrl(route.npub, route.treeName, newPath, undefined, route.linkKey);
    navigate(url);
  } else if (lastSegment === oldName) {
    updateRoute(newName);
  }
}

// Delete entry
export async function deleteEntry(name: string) {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return;

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  const newRootCid = await tree.removeEntry(
    rootCid,
    currentPath,
    name
  );
  // Publish to nostr - resolver will pick up the update
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  // Navigate to directory if deleted file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === name) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath, undefined, route.linkKey);
    navigate(url);
  }
}

// Delete current folder (must be in a subdirectory)
export async function deleteCurrentFolder() {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return;

  const route = parseRoute();
  if (route.path.length === 0) return; // Can't delete root

  const folderName = route.path[route.path.length - 1];
  const parentPath = route.path.slice(0, -1);

  const tree = getTree();

  const newRootCid = await tree.removeEntry(
    rootCid,
    parentPath,
    folderName
  );
  // Publish to nostr - resolver will pick up the update
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  // Navigate to parent directory
  const url = buildRouteUrl(route.npub, route.treeName, parentPath, undefined, route.linkKey);
  navigate(url);
}

// Move entry into a directory
export async function moveEntry(sourceName: string, targetDirName: string) {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return;
  if (sourceName === targetDirName) return;

  // Move not yet supported for encrypted trees
  if (rootCid.key) {
    alert('Move not yet supported for encrypted trees');
    return;
  }

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  // Resolve target directory from tree
  const targetPath = [...currentPath, targetDirName].join('/');
  const targetResult = await tree.resolvePath(rootCid, targetPath);
  if (!targetResult) return;

  // Check target is a directory
  if (!targetResult.isTree) return;

  // Check for name collision
  const targetContents = await tree.listDirectory(targetResult.cid);
  if (targetContents.some(e => e.name === sourceName)) {
    alert(`A file named "${sourceName}" already exists in "${targetDirName}"`);
    return;
  }

  const newRootCid = await tree.moveEntry(rootCid, currentPath, sourceName, [...currentPath, targetDirName]);
  // Publish to nostr - resolver will pick up the update
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  // Clear selection if moved file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === sourceName) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath, undefined, route.linkKey);
    navigate(url);
  }
}

// Move entry to parent directory
export async function moveToParent(sourceName: string) {
  const rootCid = getCurrentRootCid();
  if (!rootCid) return;

  // Move not yet supported for encrypted trees
  if (rootCid.key) {
    alert('Move not yet supported for encrypted trees');
    return;
  }

  const currentPath = getCurrentPathFromUrl();
  if (currentPath.length === 0) return; // Already at root

  const tree = getTree();
  const parentPath = currentPath.slice(0, -1);

  // Check for name collision in parent
  const parentCid = parentPath.length === 0
    ? rootCid
    : (await tree.resolvePath(rootCid, parentPath.join('/')))?.cid;
  if (!parentCid) return;

  const parentEntries = await tree.listDirectory(parentCid);
  if (parentEntries.some(e => e.name === sourceName)) {
    alert(`A file named "${sourceName}" already exists in the parent directory`);
    return;
  }

  const newRootCid = await tree.moveEntry(rootCid, currentPath, sourceName, parentPath);
  // Publish to nostr - resolver will pick up the update
  await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  // Clear selection if moved file was active
  const route = parseRoute();
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  if (urlFileName === sourceName) {
    const url = buildRouteUrl(route.npub, route.treeName, currentPath, undefined, route.linkKey);
    navigate(url);
  }
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

// Fork a directory as a new top-level tree
// Preserves the key if forking from an encrypted tree
export async function forkTree(dirCid: CID, name: string): Promise<boolean> {
  if (!name) return false;

  const { saveHashtree } = await import('./nostr');
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

// Upload a single file (used for "Keep as ZIP" option)
export async function uploadSingleFile(fileName: string, data: Uint8Array): Promise<void> {
  const tree = getTree();
  const route = parseRoute();
  const currentPath = getCurrentPathFromUrl();

  const { cid: fileCid, size } = await tree.putFile(data);

  let rootCid = getCurrentRootCid();

  if (rootCid) {
    const newRootCid = await tree.setEntry(
      rootCid,
      currentPath,
      fileName,
      fileCid,
      size
    );
    rootCid = newRootCid;
    markFilesChanged(new Set([fileName]));
  } else if (route.npub && route.treeName) {
    // Virtual tree case - initialize and save to nostr
    const result = await initVirtualTree([{ name: fileName, cid: fileCid, size }]);
    if (result) {
      rootCid = result;
      markFilesChanged(new Set([fileName]));
    }
  } else {
    // No tree context - create new encrypted tree
    const result = await tree.putDirectory([{ name: fileName, cid: fileCid, size }]);
    rootCid = result.cid;
    markFilesChanged(new Set([fileName]));
  }

  if (rootCid) {
    const keyHex = rootCid.key ? toHex(rootCid.key) : undefined;
    await autosaveIfOwn(toHex(rootCid.hash), keyHex);
  }
}

// Upload extracted files from an archive
// If subdirName is provided, files will be extracted into a subdirectory with that name
export async function uploadExtractedFiles(files: { name: string; data: Uint8Array; size: number }[], subdirName?: string): Promise<void> {
  if (files.length === 0) return;

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  let rootCid = getCurrentRootCid();

  // If extracting to subdirectory, create it first
  if (subdirName) {
    const { cid: emptyDirCid } = await tree.putDirectory([]);

    if (rootCid) {
      // Add subdirectory to existing tree
      const newRootCid = await tree.setEntry(
        rootCid,
        currentPath,
        subdirName,
        emptyDirCid,
        0,
        true
      );
      rootCid = newRootCid;
    } else {
      // Initialize virtual tree with the subdirectory
      const result = await initVirtualTree([{ name: subdirName, cid: emptyDirCid, size: 0, isTree: true }]);
      if (result) {
        rootCid = result;
      }
    }
  }

  // Base path for extraction (includes subdirName if provided)
  const basePath = subdirName ? [...currentPath, subdirName] : currentPath;

  // Build directory structure from file paths
  // Files may have paths like "folder/subfolder/file.txt"
  const dirEntries = new Map<string, { name: string; cid: CID; size: number; isTree?: boolean }[]>();

  for (const file of files) {
    // putFile returns CID (encrypted by default)
    const { cid: fileCid, size } = await tree.putFile(file.data);
    const pathParts = file.name.split('/');
    const fileName = pathParts.pop()!;
    const dirPath = pathParts.join('/');

    if (!dirEntries.has(dirPath)) {
      dirEntries.set(dirPath, []);
    }
    dirEntries.get(dirPath)!.push({ name: fileName, cid: fileCid, size });
  }

  // Get sorted directory paths (shortest first to create parent dirs first)
  const sortedDirs = Array.from(dirEntries.keys()).sort((a, b) => a.split('/').length - b.split('/').length);

  // Process each directory level
  for (const dirPath of sortedDirs) {
    const entries = dirEntries.get(dirPath)!;
    const targetPath = dirPath ? [...basePath, ...dirPath.split('/')] : basePath;

    for (const entry of entries) {
      if (rootCid) {
        const newRootCid = await tree.setEntry(
          rootCid,
          targetPath,
          entry.name,
          entry.cid,
          entry.size,
          entry.isTree ?? false
        );
        rootCid = newRootCid;
      } else {
        // First file - create an encrypted tree
        const result = await tree.putDirectory([{ name: entry.name, cid: entry.cid, size: entry.size }]);
        rootCid = result.cid;
      }
    }
  }

  if (rootCid) {
    // Publish to nostr - resolver will pick up the update
    const keyHex = rootCid.key ? toHex(rootCid.key) : undefined;
    await autosaveIfOwn(toHex(rootCid.hash), keyHex);
  }
}

// Create a new tree (top-level folder on nostr or local)
// Creates encrypted trees by default
// Set skipNavigation=true to create without navigating (for batch creation)
export async function createTree(name: string, visibility: import('hashtree').TreeVisibility = 'public', skipNavigation = false): Promise<{ success: boolean; linkKey?: string }> {
  if (!name) return { success: false };

  const { saveHashtree } = await import('./nostr');

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
        const { storeLinkKey } = await import('./hooks/useTrees');
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
