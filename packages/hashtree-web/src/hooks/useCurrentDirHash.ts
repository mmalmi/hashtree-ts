/**
 * Hook to compute current directory CID from rootCid + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 * Svelte version using stores
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { toHex } from 'hashtree';
import { getTree } from '../store';
import { routeStore } from './useRoute';
import { treeRootStore } from './useTreeRoot';
import { looksLikeFile } from '../utils/route';
import type { CID, Hash } from 'hashtree';

// Store for current directory CID
const currentDirCidStore = writable<CID | null>(null);

// Track previous values to avoid redundant recalculations
let prevRootHash: string | null = null;
let prevRootKey: string | null = null;
let prevPathKey: string | null = null;

// Reactive update based on rootCid and path changes
function updateCurrentDirCid() {
  const rootCid = get(treeRootStore);
  const route = get(routeStore);
  // Get directory path (exclude file if URL points to file)
  const urlPath = route.path;
  const lastSegment = urlPath.length > 0 ? urlPath[urlPath.length - 1] : null;
  const currentPath = lastSegment && looksLikeFile(lastSegment) ? urlPath.slice(0, -1) : urlPath;

  const rootHash = rootCid?.hash ? toHex(rootCid.hash) : null;
  const rootKey = rootCid?.key ? toHex(rootCid.key) : null;
  const pathKey = currentPath.join('/');

  // Skip if no change
  if (rootHash === prevRootHash && rootKey === prevRootKey && pathKey === prevPathKey) {
    return;
  }
  prevRootHash = rootHash;
  prevRootKey = rootKey;
  prevPathKey = pathKey;

  if (!rootCid || !rootHash) {
    currentDirCidStore.set(null);
    return;
  }

  if (currentPath.length === 0) {
    currentDirCidStore.set(rootCid);
    return;
  }

  // Resolve path asynchronously
  const tree = getTree();
  tree.resolvePath(rootCid, currentPath).then(result => {
    if (result) {
      currentDirCidStore.set(result.cid);
    } else {
      currentDirCidStore.set(null);
    }
  }).catch(() => {
    currentDirCidStore.set(null);
  });
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

// Compatibility functions for React-style usage
export function useCurrentDirHash(): Hash | null {
  return get(currentDirHashStore);
}

export function useCurrentDirCid(): CID | null {
  return get(currentDirCidStore);
}
