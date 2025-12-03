import { describe, it, expect, beforeEach } from 'vitest';
import {
  HashTree,
  MemoryStore,
  encrypt,
  decrypt,
  generateKey,
  keyToHex,
  keyFromHex,
  encryptedSize,
  plaintextSize,
} from '../src/index.js';

describe('crypto', () => {
  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt small data', async () => {
      const key = generateKey();
      const plaintext = new TextEncoder().encode('hello world');

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should encrypt and decrypt empty data', async () => {
      const key = generateKey();
      const plaintext = new Uint8Array(0);

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should encrypt and decrypt large data', async () => {
      const key = generateKey();
      const plaintext = new Uint8Array(1024 * 1024); // 1MB
      // Fill with pattern instead of random (crypto.getRandomValues has 64KB limit)
      for (let i = 0; i < plaintext.length; i++) {
        plaintext[i] = i % 256;
      }

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different ciphertext with different keys', async () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const plaintext = new TextEncoder().encode('hello world');

      const encrypted1 = await encrypt(plaintext, key1);
      const encrypted2 = await encrypt(plaintext, key2);

      // Different keys = different ciphertext
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should fail to decrypt with wrong key', async () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const plaintext = new TextEncoder().encode('hello world');

      const encrypted = await encrypt(plaintext, key1);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it('should fail with invalid key length', async () => {
      const shortKey = new Uint8Array(16);
      const plaintext = new TextEncoder().encode('hello');

      await expect(encrypt(plaintext, shortKey)).rejects.toThrow('32 bytes');
    });
  });

  describe('key utilities', () => {
    it('should convert key to hex and back', () => {
      const key = generateKey();
      const hex = keyToHex(key);
      const restored = keyFromHex(hex);

      expect(hex.length).toBe(64);
      expect(restored).toEqual(key);
    });

    it('should reject invalid hex length', () => {
      expect(() => keyFromHex('abc')).toThrow('64 characters');
    });
  });

  describe('size utilities', () => {
    it('should calculate encrypted size', () => {
      // IV (12) + plaintext + auth tag (16)
      expect(encryptedSize(0)).toBe(28);
      expect(encryptedSize(100)).toBe(128);
    });

    it('should calculate plaintext size', () => {
      expect(plaintextSize(28)).toBe(0);
      expect(plaintextSize(128)).toBe(100);
    });
  });
});

describe('HashTree encrypted', () => {
  let store: MemoryStore;
  let tree: HashTree;

  beforeEach(() => {
    store = new MemoryStore();
    tree = new HashTree({ store });
  });

  describe('putFile/readFile (encrypted by default)', () => {
    it('should encrypt and decrypt small file', async () => {
      const data = new TextEncoder().encode('hello encrypted world');

      // putFile() encrypts by default, returns CID with key
      const { cid, size } = await tree.putFile(data);

      expect(size).toBe(data.length);
      expect(cid.key).toBeDefined();
      expect(cid.key!.length).toBe(32);

      // readFile(cid) decrypts using the key in the CID
      const decrypted = await tree.readFile(cid);
      expect(decrypted).toEqual(data);
    });

    it('should encrypt and decrypt chunked file', async () => {
      const smallTree = new HashTree({ store, chunkSize: 10 });
      const data = new TextEncoder().encode('this is a longer message that will be chunked and encrypted');

      const { cid, size } = await smallTree.putFile(data);

      expect(size).toBe(data.length);

      const decrypted = await smallTree.readFile(cid);
      expect(decrypted).toEqual(data);
    });

    it('should derive deterministic key from content (CHK)', async () => {
      const data = new TextEncoder().encode('hello');

      // With CHK, same content always produces same key
      const result1 = await tree.putFile(data);
      const result2 = await tree.putFile(data);

      expect(result1.cid.key).toEqual(result2.cid.key);
      expect(result1.cid.hash).toEqual(result2.cid.hash);
    });

    it('should fail to decrypt with wrong key', async () => {
      const data = new TextEncoder().encode('hello');
      const { cid } = await tree.putFile(data);
      const wrongKey = generateKey();

      await expect(tree.readFile({ hash: cid.hash, key: wrongKey })).rejects.toThrow();
    });

    it('should return null for missing hash', async () => {
      const key = generateKey();
      const missingHash = new Uint8Array(32);

      const result = await tree.readFile({ hash: missingHash, key });
      expect(result).toBeNull();
    });
  });

  describe('readFileStream (encrypted)', () => {
    it('should stream decrypt small file', async () => {
      const data = new TextEncoder().encode('hello stream');
      const { cid } = await tree.putFile(data);

      const chunks: Uint8Array[] = [];
      for await (const chunk of tree.readFileStream(cid)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toEqual(data);
    });

    it('should stream decrypt chunked file', async () => {
      const smallTree = new HashTree({ store, chunkSize: 10 });
      const data = new TextEncoder().encode('this is a longer message for streaming');

      const { cid } = await smallTree.putFile(data);

      const chunks: Uint8Array[] = [];
      for await (const chunk of smallTree.readFileStream(cid)) {
        chunks.push(chunk);
      }

      // Multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Reassemble and verify
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const reassembled = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        reassembled.set(chunk, offset);
        offset += chunk.length;
      }

      expect(reassembled).toEqual(data);
    });
  });
});
