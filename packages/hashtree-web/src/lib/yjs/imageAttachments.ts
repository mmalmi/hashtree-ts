/**
 * Image Attachments Module
 * Handles image upload, storage, and retrieval for Yjs documents
 */
import { LinkType } from 'hashtree';
import type { CID } from 'hashtree';
import { getTree } from '../../store';
import { getTreeRootSync } from '../../stores';
import { autosaveIfOwn } from '../../nostr';
import { updateLocalRootCacheHex } from '../../treeRootCache';
import { toHex } from 'hashtree';

const ATTACHMENTS_DIR = 'attachments';

const MIME_TYPES: Record<string, string> = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  'avif': 'image/avif',
};

/**
 * Get MIME type from file extension
 */
export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[ext] || 'image/png';
}

/**
 * Generate a unique filename for an uploaded image
 */
export function generateImageFilename(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${random}.${ext}`;
}

/**
 * Image cache manager for blob URLs
 */
export function createImageCache() {
  const cache = new Map<string, string>();

  return {
    get(name: string): string | undefined {
      return cache.get(name);
    },
    set(name: string, url: string): void {
      cache.set(name, url);
    },
    has(name: string): boolean {
      return cache.has(name);
    },
    cleanup(): void {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    },
  };
}

export type ImageCache = ReturnType<typeof createImageCache>;

/**
 * Load an image from the tree and return a blob URL
 */
export async function loadImageFromTree(
  imageName: string,
  path: string[],
  viewedNpub: string | null,
  userNpub: string | null,
  treeName: string | null,
  cache: ImageCache
): Promise<string | null> {
  // Check cache first
  if (cache.has(imageName)) {
    return cache.get(imageName)!;
  }

  const tree = getTree();
  const attachmentsPath = [...path, ATTACHMENTS_DIR, imageName].join('/');

  // Get root CID
  let rootCid: CID | null = null;
  if (viewedNpub) {
    rootCid = treeName ? getTreeRootSync(viewedNpub, treeName) : null;
  } else if (userNpub && treeName) {
    rootCid = getTreeRootSync(userNpub, treeName);
  }

  if (!rootCid) return null;

  try {
    const result = await tree.resolvePath(rootCid, attachmentsPath);
    if (!result) return null;

    const data = await tree.readFile(result.cid);
    if (!data) return null;

    const mimeType = getMimeType(imageName);
    const blob = new Blob([data.buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    cache.set(imageName, url);
    return url;
  } catch (err) {
    console.error(`[YjsDoc] Failed to load image ${imageName}:`, err);
    return null;
  }
}

/**
 * Save an image to the attachments directory
 */
export async function saveImageToTree(
  data: Uint8Array,
  filename: string,
  path: string[],
  userNpub: string,
  treeName: string,
  isOwnTree: boolean,
  cache: ImageCache,
  visibility?: import('hashtree').TreeVisibility
): Promise<string | null> {
  const tree = getTree();

  let rootCid = getTreeRootSync(userNpub, treeName);
  if (!rootCid) {
    const { cid: emptyDirCid } = await tree.putDirectory([]);
    rootCid = emptyDirCid;
  }

  try {
    const attachmentsPath = [...path, ATTACHMENTS_DIR];

    // Ensure attachments directory exists
    const attachmentsResult = await tree.resolvePath(rootCid, attachmentsPath.join('/'));
    if (!attachmentsResult) {
      const { cid: emptyDirCid } = await tree.putDirectory([]);
      rootCid = await tree.setEntry(rootCid, path, ATTACHMENTS_DIR, emptyDirCid, 0, LinkType.Dir);
    }

    // Save the image file
    const { cid: imageCid, size: imageSize } = await tree.putFile(data);
    const newRootCid = await tree.setEntry(
      rootCid,
      attachmentsPath,
      filename,
      imageCid,
      imageSize,
      LinkType.Blob
    );

    // Publish update
    if (isOwnTree) {
      autosaveIfOwn(newRootCid);
    } else {
      updateLocalRootCacheHex(
        userNpub,
        treeName,
        toHex(newRootCid.hash),
        newRootCid.key ? toHex(newRootCid.key) : undefined,
        visibility
      );
    }

    // Cache the blob URL
    const mimeType = getMimeType(filename);
    const blob = new Blob([data.buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    cache.set(filename, url);

    return filename;
  } catch (err) {
    console.error('[YjsDoc] Failed to save image:', err);
    return null;
  }
}

/**
 * Pre-load all images from the attachments directory
 */
export async function preloadAttachments(
  path: string[],
  viewedNpub: string | null,
  userNpub: string | null,
  treeName: string | null,
  cache: ImageCache
): Promise<void> {
  const tree = getTree();
  const attachmentsPath = [...path, ATTACHMENTS_DIR].join('/');

  let rootCid: CID | null = null;
  if (viewedNpub) {
    rootCid = treeName ? getTreeRootSync(viewedNpub, treeName) : null;
  } else if (userNpub && treeName) {
    rootCid = getTreeRootSync(userNpub, treeName);
  }

  if (!rootCid) return;

  try {
    const result = await tree.resolvePath(rootCid, attachmentsPath);
    if (!result) return;

    const isDir = await tree.isDirectory(result.cid);
    if (!isDir) return;

    const attachmentEntries = await tree.listDirectory(result.cid);

    for (const entry of attachmentEntries) {
      if (entry.type !== LinkType.Dir) {
        await loadImageFromTree(entry.name, path, viewedNpub, userNpub, treeName, cache);
      }
    }
  } catch {
    // Attachments directory doesn't exist yet
  }
}
