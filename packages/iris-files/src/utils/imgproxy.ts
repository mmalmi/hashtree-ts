/**
 * Image proxy utility for proxying external images through imgproxy
 * Used for avatars, banners, and other external images
 * Based on iris-client implementation
 */
import * as utils from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { base64 } from '@scure/base';

export interface ImgProxyConfig {
  url: string;
  key: string;
  salt: string;
}

export interface ImgProxyOptions {
  width?: number;
  height?: number;
  /** If true, use fill mode (crop to fill); if false, use fit mode (contain) */
  square?: boolean;
}

// Default imgproxy configuration (same as iris-client)
export const DEFAULT_IMGPROXY_CONFIG: ImgProxyConfig = {
  url: 'https://imgproxy.iris.to',
  key: 'f66233cb160ea07078ff28099bfa3e3e654bc10aa4a745e12176c433d79b8996',
  salt: '5e608e60945dcd2a787e8465d76ba34149894765061d39287609fb9d776caa0c',
};

// URL-safe base64 encoding
function urlSafe(s: string): string {
  return s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmacSha256(key: Uint8Array, ...messages: Uint8Array[]) {
  return hmac(sha256, key, utils.concatBytes(...messages));
}

// Sign the path using HMAC-SHA256
function signUrl(path: string, key: string, salt: string): string {
  const te = new TextEncoder();
  const result = hmacSha256(
    utils.hexToBytes(key),
    utils.hexToBytes(salt),
    te.encode(path)
  );
  return urlSafe(base64.encode(result));
}

/**
 * Generate a proxied image URL
 * @param originalSrc Original image URL
 * @param options Resize options
 * @param config Custom imgproxy config (optional)
 * @returns Proxied URL or original if generation fails
 */
export function generateProxyUrl(
  originalSrc: string,
  options: ImgProxyOptions = {},
  config: ImgProxyConfig = DEFAULT_IMGPROXY_CONFIG
): string {
  try {
    // Skip if already proxied or is a data URL or blob URL
    if (
      originalSrc.startsWith(config.url) ||
      originalSrc.startsWith('data:') ||
      originalSrc.startsWith('blob:')
    ) {
      return originalSrc;
    }

    // Skip if not a valid URL
    try {
      new URL(originalSrc);
    } catch {
      return originalSrc;
    }

    const te = new TextEncoder();
    const encodedUrl = urlSafe(base64.encode(te.encode(originalSrc)));

    const opts: string[] = [];
    if (options.width || options.height) {
      const resizeType = options.square ? 'fill' : 'fit';
      const w = options.width || options.height!;
      const h = options.height || options.width!;
      opts.push(`rs:${resizeType}:${w}:${h}`);
      opts.push('dpr:2');
    } else {
      opts.push('dpr:2');
    }

    const path = `/${opts.join('/')}/${encodedUrl}`;
    const signature = signUrl(path, config.key, config.salt);

    return `${config.url}/${signature}${path}`;
  } catch (e) {
    console.error('Failed to generate proxy URL:', e);
    return originalSrc;
  }
}
