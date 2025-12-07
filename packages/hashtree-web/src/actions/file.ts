/**
 * File operations - create, save, upload files
 */
import { toHex } from 'hashtree';
import type { CID } from 'hashtree';
import { autosaveIfOwn } from '../nostr';
import { getTree } from '../store';
import { markFilesChanged } from '../hooks/useRecentlyChanged';
import { parseRoute } from '../utils/route';
import { getCurrentRootCid, getCurrentPathFromUrl, updateRoute } from './route';
import { initVirtualTree } from './tree';

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
  autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

  return data;
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
    autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
  } else {
    // Initialize virtual tree with this file
    const result = await initVirtualTree([{ name, cid: fileCid, size }]);
    if (!result) return; // Failed to initialize
  }

  // Navigate to the newly created file with edit mode
  updateRoute(name, { edit: true });
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
    autosaveIfOwn(toHex(rootCid.hash), keyHex);
  }
}

// Upload extracted files from an archive
// If subdirName is provided, files will be extracted into a subdirectory with that name
export async function uploadExtractedFiles(files: { name: string; data: Uint8Array; size: number }[], subdirName?: string): Promise<void> {
  if (files.length === 0) return;

  const tree = getTree();
  const currentPath = getCurrentPathFromUrl();

  let rootCid: CID | null = getCurrentRootCid();

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
    autosaveIfOwn(toHex(rootCid.hash), keyHex);
  }
}
