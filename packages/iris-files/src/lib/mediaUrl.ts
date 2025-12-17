/**
 * Media URL Helper
 *
 * Generates URLs for streaming media through the service worker.
 * URLs are in the format: /media/{cidHex}/{path}
 *
 * The service worker intercepts these URLs and streams data from the worker.
 */

import { toHex, type CID } from 'hashtree';

/**
 * Generate a media URL for a CID and optional path
 *
 * @param cid - The content ID
 * @param path - Optional file path (used for MIME type detection)
 * @returns URL string like /media/abc123/video.mp4
 */
export function getMediaUrl(cid: CID, path: string = ''): string {
  const cidHex = toHex(cid.hash);
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  return `/media/${cidHex}/${encodedPath}`;
}

/**
 * Parse a media URL back to CID hex and path
 *
 * @param url - URL string like /media/abc123/video.mp4
 * @returns Object with cidHex and path, or null if not a media URL
 */
export function parseMediaUrl(url: string): { cidHex: string; path: string } | null {
  const match = url.match(/^\/media\/([a-f0-9]+)\/(.*)$/i);
  if (!match) return null;
  return {
    cidHex: match[1],
    path: decodeURIComponent(match[2]),
  };
}

/**
 * Check if the service worker is ready to handle media requests
 */
export async function isMediaStreamingAvailable(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  return !!registration.active;
}
