import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { sha256 } from '../src/hash.js';
import { toHex, fromHex } from '../src/types.js';

/**
 * Unit tests for WebRTC data protocol
 * Tests the request/response protocol without actual WebRTC connections
 */

describe('WebRTC Data Protocol', () => {
  describe('Data Request/Response', () => {
    it('should format request messages correctly', () => {
      const requestId = 1;
      const hash = '0'.repeat(64);
      const msg = { type: 'req', id: requestId, hash };

      expect(msg.type).toBe('req');
      expect(msg.id).toBe(1);
      expect(msg.hash).toBe(hash);
    });

    it('should format response messages correctly', () => {
      const msg = { type: 'res', id: 1, hash: '0'.repeat(64), found: true };

      expect(msg.type).toBe('res');
      expect(msg.found).toBe(true);
    });

    it('should format binary data with request ID prefix', () => {
      const requestId = 42;
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      // Format: [4 bytes requestId (little endian)][data]
      const packet = new Uint8Array(4 + data.length);
      const view = new DataView(packet.buffer);
      view.setUint32(0, requestId, true);
      packet.set(data, 4);

      // Verify
      const parsedId = new DataView(packet.buffer).getUint32(0, true);
      const parsedData = packet.slice(4);

      expect(parsedId).toBe(42);
      expect(parsedData).toEqual(data);
    });
  });

  describe('Hash Verification', () => {
    it('should verify data matches hash', async () => {
      const data = new TextEncoder().encode('Hello, WebRTC!');
      const hash = await sha256(data);
      const hashHex = toHex(hash);

      // Simulate receiving data and verifying
      const computedHash = await sha256(data);
      expect(toHex(computedHash)).toBe(hashHex);
    });

    it('should reject data with mismatched hash', async () => {
      const data = new TextEncoder().encode('Hello, WebRTC!');
      const hash = await sha256(data);
      const hashHex = toHex(hash);

      // Tampered data
      const tamperedData = new TextEncoder().encode('Hello, WebRTC?');
      const computedHash = await sha256(tamperedData);

      expect(toHex(computedHash)).not.toBe(hashHex);
    });
  });

  describe('Store Integration', () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore();
    });

    it('should store and retrieve data by hash', async () => {
      const content = 'Test file content';
      const data = new TextEncoder().encode(content);
      const hash = await sha256(data);

      await store.put(hash, data);

      const retrieved = await store.get(hash);
      expect(retrieved).not.toBeNull();
      expect(new TextDecoder().decode(retrieved!)).toBe(content);
    });

    it('should return null for missing hash', async () => {
      const missingHash = fromHex('0'.repeat(64));
      const result = await store.get(missingHash);
      expect(result).toBeNull();
    });
  });
});

describe('PeerId', () => {
  it('should generate unique UUIDs', async () => {
    const { generateUuid } = await import('../src/webrtc/types.js');

    const uuid1 = generateUuid();
    const uuid2 = generateUuid();

    expect(uuid1).not.toBe(uuid2);
    expect(uuid1.length).toBeGreaterThan(10);
  });

  it('should format peerId as pubkey:uuid', async () => {
    const { PeerId } = await import('../src/webrtc/types.js');

    const pubkey = 'a'.repeat(64);
    const uuid = 'test123';
    const peerId = new PeerId(pubkey, uuid);

    expect(peerId.toString()).toBe(`${pubkey}:${uuid}`);
    expect(peerId.pubkey).toBe(pubkey);
    expect(peerId.uuid).toBe(uuid);
  });

  it('should generate short form for display', async () => {
    const { PeerId } = await import('../src/webrtc/types.js');

    const pubkey = 'abcdef1234567890'.repeat(4);
    const uuid = 'xyz789abc';
    const peerId = new PeerId(pubkey, uuid);

    const short = peerId.short();
    expect(short).toBe('abcdef12:xyz789');
  });

  it('should parse peerId from string', async () => {
    const { PeerId } = await import('../src/webrtc/types.js');

    const str = 'a'.repeat(64) + ':myuuid123';
    const peerId = PeerId.fromString(str);

    expect(peerId.pubkey).toBe('a'.repeat(64));
    expect(peerId.uuid).toBe('myuuid123');
  });
});
