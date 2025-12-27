/**
 * Hook to compute current directory CID from rootCid + URL path
 * For encrypted trees, resolves through the path collecting keys at each level
 * Svelte version using stores
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { toHex, LinkType } from 'hashtree';
import { getTree } from '../store';
import { routeStore } from './route';
import { treeRootStore } from './treeRoot';
import type { CID, Hash } from 'hashtree';

// Store for current directory CID
const currentDirCidStore = writable<CID | null>(null);

// Store for whether we're viewing a file (not a directory)
const isViewingFileStore = writable<boolean>(false);

// Store for whether path resolution is in progress (prevents flash of wrong content)
// This is true when:
// 1. We have path segments but no root CID yet (waiting for tree to load)
// 2. We're actively resolving the path to determine if it's a file or directory
const resolvingPathStore = writable<boolean>(false);

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

  // Check if only root changed (not path) - this is a merkle root update, don't show loading
  const isRootOnlyChange = pathKey === prevPathKey && prevRootHash !== null;

  prevRootHash = rootHash;
  prevRootKey = rootKey;
  prevPathKey = pathKey;

  // If we have path segments but no root CID, we're waiting for tree to load
  if (!rootCid || !rootHash) {
    currentDirCidStore.set(null);
    isViewingFileStore.set(false);
    // Set resolving=true if we have path segments AND this is a path change (not just root update)
    if (!isRootOnlyChange) {
      resolvingPathStore.set(urlPath.length > 0);
    }
    return;
  }

  if (urlPath.length === 0) {
    // For permalinks, the hash might point to a file directly (not a tree)
    // Check if it's a directory before assuming
    const route = get(routeStore);
    if (route.isPermalink) {
      // Only show resolving state on initial load, not on root updates
      if (!isRootOnlyChange) {
        resolvingPathStore.set(true);
      }
      const tree = getTree();
      try {
        const isDir = await tree.isDirectory(rootCid);
        if (isDir) {
          currentDirCidStore.set(rootCid);
          isViewingFileStore.set(false);
        } else {
          // The nhash points directly to a file, not a tree
          currentDirCidStore.set(null);
          isViewingFileStore.set(true);
        }
      } catch {
        // If we can't determine, assume it's a directory
        currentDirCidStore.set(rootCid);
        isViewingFileStore.set(false);
      }
      resolvingPathStore.set(false);
      return;
    }

    currentDirCidStore.set(rootCid);
    isViewingFileStore.set(false);
    resolvingPathStore.set(false);
    return;
  }

  // Mark as resolving before async work - but only on path changes, not root updates
  // This prevents flicker when viewing a livestream and merkle root updates
  if (!isRootOnlyChange) {
    resolvingPathStore.set(true);
  }

  const tree = getTree();

  try {
    // For permalinks with a single path segment, check if rootCid is a file or directory
    // - If file: the path segment is just a MIME type hint, use rootCid directly
    // - If directory: the path segment is a filename to look up in the directory
    const route = get(routeStore);
    if (route.isPermalink && urlPath.length === 1) {
      const isDir = await tree.isDirectory(rootCid);
      if (!isDir) {
        // rootCid points to a file - path is just a filename hint for MIME type
        currentDirCidStore.set(null);
        isViewingFileStore.set(true);
        resolvingPathStore.set(false);
        return;
      }
      // rootCid is a directory - path is a file to look up within it
      // Fall through to resolvePath below
    }

    // Resolve full path first - returns { cid, type } with LinkType
    const result = await tree.resolvePath(rootCid, urlPath);
    if (!result) {
      // Keep resolvingPath=true - root might be stale and updating
      // The currentDirCid stays null but we don't mark as "resolved" yet
      // If a new root comes in, we'll try again via the subscription
      return;
    }

    // Use type from resolvePath result (no extra store fetch needed)
    const isDir = result.type === LinkType.Dir;

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
    resolvingPathStore.set(false);
  } catch {
    currentDirCidStore.set(null);
    isViewingFileStore.set(false);
    resolvingPathStore.set(false);
  }
}

// Subscribe to changes in root and route - use lazy initialization for HMR compatibility
// Store the flag on a global to persist across HMR module reloads
const HMR_KEY = '__currentDirHashInitialized';
const globalObj = typeof globalThis !== 'undefined' ? globalThis : window;

function initSubscriptions() {
  if ((globalObj as Record<string, unknown>)[HMR_KEY]) return;
  (globalObj as Record<string, unknown>)[HMR_KEY] = true;

  treeRootStore.subscribe(() => {
    updateCurrentDirCid();
  });
  routeStore.subscribe(() => {
    updateCurrentDirCid();
  });
}

// Initialize on first access
initSubscriptions();

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

/**
 * Store for whether path resolution is in progress
 * Use to wait before rendering to avoid flash of wrong content
 */
export { resolvingPathStore };

// Compatibility functions for React-style usage
export function currentDirHash(): Hash | null {
  return get(currentDirHashStore);
}

export function useCurrentDirCid(): CID | null {
  return get(currentDirCidStore);
}
