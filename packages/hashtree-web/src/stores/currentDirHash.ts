/**
 * Hook to compute current directory CID from rootCid + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 * Svelte version using stores
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { toHex } from 'hashtree';
import { getTree } from '../store';
import { routeStore } from './route';
import { treeRootStore } from './treeRoot';
import type { CID, Hash } from 'hashtree';

// Store for current directory CID
const currentDirCidStore = writable<CID | null>(null);

// Store for whether we're viewing a file (not a directory)
const isViewingFileStore = writable<boolean>(false);

// Track previous values to avoid redundant recalculations
let prevRootHash: string | null = null;
let prevRootKey: string | null = null;
let prevPathKey: string | null = null;

// Reactive update based on rootCid and path changes
async function updateCurrentDirCid() {
  const rootCid = get(treeRootStore);
  const route = get(routeStore);
  const urlPath = route.path;

  const rootHash = rootCid?.hash ? toHex(rootCid.hash) : null;
  const rootKey = rootCid?.key ? toHex(rootCid.key) : null;
  const pathKey = urlPath.join('/');

  // Skip if no change
  if (rootHash === prevRootHash && rootKey === prevRootKey && pathKey === prevPathKey) {
    return;
  }
  prevRootHash = rootHash;
  prevRootKey = rootKey;
  prevPathKey = pathKey;

  if (!rootCid || !rootHash) {
    currentDirCidStore.set(null);
    isViewingFileStore.set(false);
    return;
  }

  if (urlPath.length === 0) {
    currentDirCidStore.set(rootCid);
    isViewingFileStore.set(false);
    return;
  }

  const tree = getTree();

  try {
    // Resolve full path first
    const result = await tree.resolvePath(rootCid, urlPath);
    if (!result) {
      currentDirCidStore.set(null);
      isViewingFileStore.set(false);
      return;
    }

    // Check if resolved path is a directory
    const isDir = await tree.isDirectory(result.cid);

    if (isDir) {
      // Path points to a directory
      currentDirCidStore.set(result.cid);
      isViewingFileStore.set(false);
    } else {
      // Path points to a file - get parent directory
      isViewingFileStore.set(true);
      if (urlPath.length === 1) {
        // File is in root
        currentDirCidStore.set(rootCid);
      } else {
        // Resolve parent directory
        const parentPath = urlPath.slice(0, -1);
        const parentResult = await tree.resolvePath(rootCid, parentPath);
        currentDirCidStore.set(parentResult?.cid ?? null);
      }
    }
  } catch {
    currentDirCidStore.set(null);
    isViewingFileStore.set(false);
  }
}

// Subscribe to changes in root and route
treeRootStore.subscribe(() => updateCurrentDirCid());
routeStore.subscribe(() => updateCurrentDirCid());

/**
 * Store for current directory hash
 */
export const currentDirHashStore: Readable<Hash | null> = derived(
  currentDirCidStore,
  ($cid) => $cid?.hash ?? null
);

/**
 * Store for current directory CID
 */
export { currentDirCidStore };

/**
 * Store for whether current URL path points to a file (not a directory)
 */
export { isViewingFileStore };

// Compatibility functions for React-style usage
export function currentDirHash(): Hash | null {
  return get(currentDirHashStore);
}

export function useCurrentDirCid(): CID | null {
  return get(currentDirCidStore);
}
