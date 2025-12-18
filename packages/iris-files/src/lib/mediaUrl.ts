/**
 * File URL Helper
 *
 * Generates URLs for streaming files through the service worker.
 * The SW intercepts these URLs and streams data from the hashtree worker.
 *
 * URL formats (namespaced under /htree/ for reusability):
 * - /htree/{npub}/{treeName}/{path} - Npub-based file access (mutable)
 * - /htree/{nhash}/{filename} - Direct nhash access (content-addressed, immutable)
 */

import { nhashEncode, type CID } from 'hashtree';

/**
 * Generate a file URL for npub-based access
 *
 * @param npub - The npub of the user
 * @param treeName - The tree name (e.g., 'public' or 'videos/My Video')
 * @param path - File path within the tree
 * @returns URL string like /htree/npub1.../public/video.mp4
 */
export function getNpubFileUrl(npub: string, treeName: string, path: string): string {
  // Encode treeName as a single path segment (replace / with encoded form)
  const encodedTreeName = encodeURIComponent(treeName);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/htree/${npub}/${encodedTreeName}/${encodedPath}`;
}

/**
 * Generate a file URL for direct nhash access (content-addressed)
 *
 * @param cid - The content ID (with Uint8Array fields)
 * @param filename - Optional filename (for MIME type detection). If omitted, URL is just /htree/{nhash}
 * @returns URL string like /htree/nhash1... or /htree/nhash1.../video.mp4
 */
export function getNhashFileUrl(cid: CID, filename?: string): string {
  // nhashEncode now accepts CID directly with Uint8Array fields
  const nhash = nhashEncode(cid);
  if (filename) {
    return `/htree/${nhash}/${encodeURIComponent(filename)}`;
  }
  return `/htree/${nhash}`;
}

/**
 * Legacy alias for getNhashFileUrl (backwards compatibility)
 */
export function getCidFileUrl(cid: CID, filename: string = 'file'): string {
  return getNhashFileUrl(cid, filename);
}

/**
 * Legacy alias for getNhashFileUrl (backwards compatibility)
 */
export function getMediaUrl(cid: CID, path: string = ''): string {
  return getNhashFileUrl(cid, path);
}

/**
 * Check if service worker is ready to handle file requests
 */
export async function isFileStreamingAvailable(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  return !!registration.active;
}
