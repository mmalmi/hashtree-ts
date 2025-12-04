/**
 * Tests for visibility encryption utilities
 */
import { describe, it, expect } from 'vitest';
import {
  generateLinkKey,
  computeKeyId,
  encryptKeyForLink,
  decryptKeyFromLink,
  visibilityHex,
} from '../src/index.js';

describe('visibility', () => {
  describe('generateLinkKey', () => {
    it('should generate 32-byte key', () => {
      const key = generateLinkKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should generate unique keys', () => {
      const key1 = generateLinkKey();
      const key2 = generateLinkKey();
      expect(key1).not.toEqual(key2);
    });
  });

  describe('computeKeyId', () => {
    it('should return 8-byte hash of key', async () => {
      const key = generateLinkKey();
      const keyId = await computeKeyId(key);
      expect(keyId).toBeInstanceOf(Uint8Array);
      expect(keyId.length).toBe(8);
    });

    it('should be deterministic', async () => {
      const key = generateLinkKey();
      const keyId1 = await computeKeyId(key);
      const keyId2 = await computeKeyId(key);
      expect(keyId1).toEqual(keyId2);
    });
  });

  describe('encryptKeyForLink / decryptKeyFromLink', () => {
    it('should encrypt and decrypt CHK key', async () => {
      const chkKey = crypto.getRandomValues(new Uint8Array(32));
      const linkKey = generateLinkKey();

      const encrypted = await encryptKeyForLink(chkKey, linkKey);
      expect(encrypted.length).toBeGreaterThan(32); // nonce + ciphertext + tag

      const decrypted = await decryptKeyFromLink(encrypted, linkKey);
      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(chkKey);
    });

    it('should fail with wrong link key', async () => {
      const chkKey = crypto.getRandomValues(new Uint8Array(32));
      const linkKey = generateLinkKey();
      const wrongKey = generateLinkKey();

      const encrypted = await encryptKeyForLink(chkKey, linkKey);
      const decrypted = await decryptKeyFromLink(encrypted, wrongKey);
      expect(decrypted).toBeNull();
    });

    it('should produce different ciphertext each time (random nonce)', async () => {
      const chkKey = crypto.getRandomValues(new Uint8Array(32));
      const linkKey = generateLinkKey();

      const encrypted1 = await encryptKeyForLink(chkKey, linkKey);
      const encrypted2 = await encryptKeyForLink(chkKey, linkKey);

      // Should be different due to random nonce
      expect(encrypted1).not.toEqual(encrypted2);

      // But both should decrypt to same key
      const decrypted1 = await decryptKeyFromLink(encrypted1, linkKey);
      const decrypted2 = await decryptKeyFromLink(encrypted2, linkKey);
      expect(decrypted1).toEqual(chkKey);
      expect(decrypted2).toEqual(chkKey);
    });
  });

  describe('hex helpers', () => {
    it('should generate hex link key', () => {
      const key = visibilityHex.generateLinkKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('should compute hex keyId', async () => {
      const key = visibilityHex.generateLinkKey();
      const keyId = await visibilityHex.computeKeyId(key);
      expect(typeof keyId).toBe('string');
      expect(keyId.length).toBe(16); // 8 bytes = 16 hex chars
    });

    it('should encrypt and decrypt with hex', async () => {
      const chkKey = visibilityHex.generateLinkKey(); // Use as CHK key
      const linkKey = visibilityHex.generateLinkKey();

      const encrypted = await visibilityHex.encryptKeyForLink(chkKey, linkKey);
      expect(typeof encrypted).toBe('string');

      const decrypted = await visibilityHex.decryptKeyFromLink(encrypted, linkKey);
      expect(decrypted).toBe(chkKey);
    });

    it('should return null for invalid hex decryption', async () => {
      const encrypted = visibilityHex.generateLinkKey(); // Not valid encrypted data
      const linkKey = visibilityHex.generateLinkKey();

      const decrypted = await visibilityHex.decryptKeyFromLink(encrypted, linkKey);
      expect(decrypted).toBeNull();
    });
  });
});
