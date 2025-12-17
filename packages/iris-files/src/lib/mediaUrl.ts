/**
 * File URL Helper
 *
 * Generates URLs for streaming files through the service worker.
 * The SW intercepts these URLs and streams data from the hashtree worker.
 *
 * URL formats (namespaced under /htree/ for reusability):
 * - /htree/npub/{npub}/{treeName}/{path} - Npub-based file access
 * - /htree/cid/{cidHex}/{filename} - Direct CID access
 */

import { toHex, type CID } from 'hashtree';

/**
 * Generate a file URL for npub-based access
 *
 * @param npub - The npub of the user
 * @param treeName - The tree name (e.g., 'public')
 * @param path - File path within the tree
 * @returns URL string like /htree/npub/npub1.../public/video.mp4
 */
export function getNpubFileUrl(npub: string, treeName: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/htree/npub/${npub}/${treeName}/${encodedPath}`;
}

/**
 * Generate a file URL for direct CID access
 *
 * @param cid - The content ID
 * @param filename - Filename (for MIME type detection)
 * @returns URL string like /htree/cid/abc123/video.mp4
 */
export function getCidFileUrl(cid: CID, filename: string = 'file'): string {
  const cidHex = toHex(cid.hash);
  return `/htree/cid/${cidHex}/${encodeURIComponent(filename)}`;
}

/**
 * Legacy alias for getCidFileUrl (backwards compatibility)
 */
export function getMediaUrl(cid: CID, path: string = ''): string {
  return getCidFileUrl(cid, path);
}

/**
 * Check if service worker is ready to handle file requests
 */
export async function isFileStreamingAvailable(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  return !!registration.active;
}
