/**
 * Compression utilities using fflate for ZIP creation and extraction
 */
import { zipSync, unzipSync, type Zippable, type Unzipped } from 'fflate';
import type { HashTree, CID } from 'hashtree';
import { LinkType } from 'hashtree';

export interface ZipProgress {
  current: number;
  total: number;
  fileName: string;
}

export type ProgressCallback = (progress: ZipProgress) => void;

/**
 * Check if a file is a supported archive format
 */
export function isArchiveFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'zip';
}

/**
 * Get archive entries from a ZIP file
 */
export function extractZip(data: Uint8Array): Unzipped {
  return unzipSync(data);
}

interface CollectedItem {
  cid: CID;
  size?: number;
  isDirectory: boolean;
}

/**
 * Recursively collect all files and empty directories from a directory tree
 */
async function collectFiles(
  tree: HashTree,
  dirCid: CID,
  basePath: string,
  items: Map<string, CollectedItem>,
  onProgress?: ProgressCallback,
  counter = { value: 0 }
): Promise<boolean> {
  const entries = await tree.listDirectory(dirCid);

  // If directory is empty, return false to indicate it should be added as empty dir
  if (entries.length === 0) {
    return false;
  }

  let hasContent = false;

  for (const entry of entries) {
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.type === LinkType.Dir) {
      // Recursively collect from subdirectory
      const subdirHasContent = await collectFiles(tree, entry.cid, fullPath, items, onProgress, counter);
      if (!subdirHasContent) {
        // Empty directory - add it with trailing slash
        items.set(fullPath + '/', { cid: entry.cid, isDirectory: true });
      }
      hasContent = true;
    } else {
      items.set(fullPath, { cid: entry.cid, size: entry.size, isDirectory: false });
      counter.value++;
      onProgress?.({
        current: counter.value,
        total: -1, // Unknown total during collection
        fileName: fullPath,
      });
      hasContent = true;
    }
  }

  return hasContent;
}

/**
 * Create a ZIP file from a directory in the HashTree
 */
export async function createZipFromDirectory(
  tree: HashTree,
  dirCid: CID,
  dirName: string,
  onProgress?: ProgressCallback
): Promise<Uint8Array> {
  // Collect all files and empty directories
  const items = new Map<string, CollectedItem>();
  await collectFiles(tree, dirCid, '', items, onProgress);

  // Count only files for progress (not empty dirs)
  const fileCount = Array.from(items.values()).filter(i => !i.isDirectory).length;
  const zipFiles: Zippable = {};
  let current = 0;

  // Read and add each item to the zip
  for (const [path, info] of items) {
    if (info.isDirectory) {
      // Empty directory - add as empty Uint8Array with trailing slash path
      zipFiles[path] = new Uint8Array(0);
    } else {
      current++;
      onProgress?.({
        current,
        total: fileCount,
        fileName: path,
      });

      const data = await tree.readFile(info.cid);
      if (data) {
        zipFiles[path] = data;
      }
    }
  }

  // Create the ZIP
  return zipSync(zipFiles, {
    level: 6, // Balanced compression
  });
}

/**
 * Extract files from an archive and return them as name->data pairs
 */
export interface ExtractedFile {
  name: string;
  data: Uint8Array;
  isDirectory: boolean;
}

export function extractArchive(data: Uint8Array, fileName: string): ExtractedFile[] {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext !== 'zip') {
    throw new Error(`Unsupported archive format: ${ext}`);
  }

  const unzipped = unzipSync(data);
  const files: ExtractedFile[] = [];

  for (const [name, content] of Object.entries(unzipped)) {
    // Skip Mac OS X metadata
    if (name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) {
      continue;
    }

    // Check if it's a directory (ends with / or empty content)
    const isDirectory = name.endsWith('/') || content.length === 0;

    if (!isDirectory) {
      files.push({
        name: name.replace(/\/$/, ''), // Remove trailing slash if any
        data: content,
        isDirectory: false,
      });
    }
  }

  return files;
}

/**
 * Download a Uint8Array as a file
 */
export function downloadBlob(data: Uint8Array, fileName: string, mimeType: string = 'application/octet-stream'): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
