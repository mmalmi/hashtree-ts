/**
 * Tree visibility utilities
 *
 * Visibility levels:
 * - public: Anyone can browse (key published in plaintext)
 * - unlisted: Only accessible with link containing decryption key
 * - private: Only owner can access (key encrypted to self)
 */

import { sha256 } from './hash.js';
import { toHex, fromHex } from './types.js';

/**
 * Tree visibility levels
 */
export type TreeVisibility = 'public' | 'unlisted' | 'private';

/**
 * Generate a random 32-byte link key for unlisted trees
 */
export function generateLinkKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Compute keyId from link key (first 8 bytes of SHA-256 hash)
 * Used to identify which link key was used without revealing the key
 */
export async function computeKeyId(linkKey: Uint8Array): Promise<Uint8Array> {
  const hash = await sha256(linkKey);
  return hash.slice(0, 8);
}

/**
 * Encrypt a CHK key for unlisted visibility using AES-GCM
 * @param chkKey - The CHK key to encrypt (32 bytes)
 * @param linkKey - The link decryption key (32 bytes)
 * @returns Encrypted key (12-byte nonce + ciphertext)
 */
export async function encryptKeyForLink(chkKey: Uint8Array, linkKey: Uint8Array): Promise<Uint8Array> {
  // Copy to clean ArrayBuffer to avoid SharedArrayBuffer type issues
  const keyBuffer = new ArrayBuffer(linkKey.length);
  new Uint8Array(keyBuffer).set(linkKey);
  const dataBuffer = new ArrayBuffer(chkKey.length);
  new Uint8Array(dataBuffer).set(chkKey);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt']
  );

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, cryptoKey, dataBuffer
  );

  // Prepend nonce to ciphertext
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(nonce);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/**
 * Decrypt a CHK key for unlisted visibility using AES-GCM
 * @param encryptedKey - Encrypted key (12-byte nonce + ciphertext)
 * @param linkKey - The link decryption key (32 bytes)
 * @returns Decrypted CHK key (32 bytes), or null if decryption fails
 */
export async function decryptKeyFromLink(encryptedKey: Uint8Array, linkKey: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Copy to clean ArrayBuffer to avoid SharedArrayBuffer type issues
    const keyBuffer = new ArrayBuffer(linkKey.length);
    new Uint8Array(keyBuffer).set(linkKey);

    const nonce = encryptedKey.slice(0, 12);
    const ciphertext = encryptedKey.slice(12);
    const ciphertextBuffer = new ArrayBuffer(ciphertext.length);
    new Uint8Array(ciphertextBuffer).set(ciphertext);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce }, cryptoKey, ciphertextBuffer
    );

    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

/**
 * Hex string versions of the encryption functions for convenience
 */
export const hex = {
  generateLinkKey(): string {
    return toHex(generateLinkKey());
  },

  async computeKeyId(linkKeyHex: string): Promise<string> {
    const keyId = await computeKeyId(fromHex(linkKeyHex));
    return toHex(keyId);
  },

  async encryptKeyForLink(chkKeyHex: string, linkKeyHex: string): Promise<string> {
    const encrypted = await encryptKeyForLink(fromHex(chkKeyHex), fromHex(linkKeyHex));
    return toHex(encrypted);
  },

  async decryptKeyFromLink(encryptedKeyHex: string, linkKeyHex: string): Promise<string | null> {
    const decrypted = await decryptKeyFromLink(fromHex(encryptedKeyHex), fromHex(linkKeyHex));
    return decrypted ? toHex(decrypted) : null;
  },
};
