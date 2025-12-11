import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encode, decode } from '@msgpack/msgpack';
import { sha256 } from '../src/hash.js';
import { MSG_TYPE_REQUEST, MSG_TYPE_RESPONSE } from '../src/webrtc/types.js';
import {
  encodeRequest,
  encodeResponse,
  createRequest,
  createResponse,
  parseMessage,
  hashToKey,
} from '../src/webrtc/protocol.js';

// Helper to create wire format message (type byte + msgpack body)
function createWireMessage(type: number, body: unknown): ArrayBuffer {
  const bodyBytes = encode(body);
  const result = new Uint8Array(1 + bodyBytes.length);
  result[0] = type;
  result.set(bodyBytes, 1);
  return result.buffer;
}

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

  private sentMessages: unknown[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string | ArrayBuffer): void {
    this.onmessage?.({ data });
  }

  simulateError(err: unknown): void {
    this.onerror?.(err);
  }

  getSentMessages(): unknown[] {
    return this.sentMessages;
  }
}

// Store reference to mock WebSocket
let mockWs: MockWebSocket | null = null;

// Setup global mock
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  mockWs = null;
  (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWs = this;
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('WebSocketPeer', () => {
  it('should connect to server', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
    });

    // Start connect but don't await yet
    const connectPromise = peer.connect();

    // Simulate server accepting connection
    setTimeout(() => mockWs?.simulateOpen(), 10);

    const result = await connectPromise;
    expect(result).toBe(true);
    expect(peer.isConnected).toBe(true);
  });

  it('should handle connection failure', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
    });

    // Start connect
    const connectPromise = peer.connect();

    // Simulate error
    setTimeout(() => mockWs?.simulateError(new Error('Connection refused')), 10);

    const result = await connectPromise;
    expect(result).toBe(false);
    expect(peer.isConnected).toBe(false);
  });

  it('should send request in correct format', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
    });

    // Connect
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Send a request
    const testHash = new Uint8Array(32);
    testHash.fill(0xab);
    peer.request(testHash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check sent message
    const sent = mockWs?.getSentMessages()[0] as ArrayBuffer;
    expect(sent).toBeInstanceOf(ArrayBuffer);

    // Parse it back
    const bytes = new Uint8Array(sent);
    expect(bytes[0]).toBe(MSG_TYPE_REQUEST); // Type byte

    // Parse msgpack body
    const body = decode(bytes.slice(1)) as { h: Uint8Array; htl?: number };
    expect(body.h).toBeDefined();
    expect(body.h.length).toBe(32);
  });

  it('should handle successful response', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 5000,
    });

    // Connect
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Prepare test data
    const testData = new TextEncoder().encode('hello world');
    const hash = await sha256(testData);

    // Start request
    const requestPromise = peer.request(hash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate response with data
    const response = createWireMessage(MSG_TYPE_RESPONSE, { h: hash, d: testData });
    mockWs?.simulateMessage(response);

    // Await result
    const result = await requestPromise;

    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!)).toBe('hello world');
  });

  it('should handle timeout (no response)', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 100, // Short timeout
    });

    // Connect
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Prepare test data
    const testData = new TextEncoder().encode('missing');
    const hash = await sha256(testData);

    // Start request - don't send any response
    const requestPromise = peer.request(hash);

    // Await result - should timeout and return null
    const result = await requestPromise;
    expect(result).toBeNull();
  });

  it('should close and cleanup pending requests', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 5000,
    });

    // Connect
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Start a request
    const hash = new Uint8Array(32);
    const requestPromise = peer.request(hash);

    // Close connection
    peer.close();

    // Request should resolve to null
    const result = await requestPromise;
    expect(result).toBeNull();
    expect(peer.isConnected).toBe(false);
  });

  it('should reject data with mismatched hash', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 5000,
    });

    // Connect
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Request for specific hash
    const expectedData = new TextEncoder().encode('expected');
    const expectedHash = await sha256(expectedData);

    // Start request
    const requestPromise = peer.request(expectedHash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Send wrong data (different hash)
    const wrongData = new TextEncoder().encode('wrong data');
    const response = createWireMessage(MSG_TYPE_RESPONSE, { h: expectedHash, d: wrongData });
    mockWs?.simulateMessage(response);

    // Result should be null due to hash mismatch
    const result = await requestPromise;
    expect(result).toBeNull();
  });
});

describe('Binary Protocol Format', () => {
  it('should format request message correctly', () => {
    const hash = new Uint8Array(32);
    hash.fill(0xab);

    const req = createRequest(hash, 10);
    const wire = encodeRequest(req);

    const bytes = new Uint8Array(wire);
    expect(bytes[0]).toBe(MSG_TYPE_REQUEST);

    const body = decode(bytes.slice(1)) as { h: Uint8Array; htl?: number };
    expect(body.h.length).toBe(32);
    expect(body.htl).toBe(10);
  });

  it('should format response message with binary data', () => {
    const hash = new Uint8Array(32);
    hash.fill(0xcd);
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    const res = createResponse(hash, data);
    const wire = encodeResponse(res);

    const bytes = new Uint8Array(wire);
    expect(bytes[0]).toBe(MSG_TYPE_RESPONSE);

    const body = decode(bytes.slice(1)) as { h: Uint8Array; d: Uint8Array };
    expect(body.h.length).toBe(32);
    expect(new Uint8Array(body.d)).toEqual(data);
  });

  it('should handle 16KB data (BT v2 chunk size)', () => {
    const hash = new Uint8Array(32);
    const data = new Uint8Array(16 * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }

    const res = createResponse(hash, data);
    const wire = encodeResponse(res);

    const bytes = new Uint8Array(wire);
    expect(bytes[0]).toBe(MSG_TYPE_RESPONSE);

    const body = decode(bytes.slice(1)) as { h: Uint8Array; d: Uint8Array };
    expect(new Uint8Array(body.d).length).toBe(16 * 1024);
    expect(new Uint8Array(body.d)[0]).toBe(0);
    expect(new Uint8Array(body.d)[16383]).toBe(16383 % 256);
  });
});

describe('Protocol Parsing', () => {
  it('should parse request message', () => {
    const hash = new Uint8Array(32);
    hash.fill(0x12);

    const wire = createWireMessage(MSG_TYPE_REQUEST, { h: hash, htl: 5 });
    const msg = parseMessage(wire);

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe(MSG_TYPE_REQUEST);
    expect((msg!.body as { h: Uint8Array }).h.length).toBe(32);
    expect((msg!.body as { htl: number }).htl).toBe(5);
  });

  it('should parse response message', () => {
    const hash = new Uint8Array(32);
    hash.fill(0x34);
    const data = new Uint8Array([10, 20, 30]);

    const wire = createWireMessage(MSG_TYPE_RESPONSE, { h: hash, d: data });
    const msg = parseMessage(wire);

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe(MSG_TYPE_RESPONSE);
    expect((msg!.body as { h: Uint8Array }).h.length).toBe(32);
    expect(new Uint8Array((msg!.body as { d: Uint8Array }).d)).toEqual(data);
  });

  it('should return null for invalid message', () => {
    const msg = parseMessage(new ArrayBuffer(0));
    expect(msg).toBeNull();
  });

  it('should return null for unknown message type', () => {
    const wire = createWireMessage(0xFF, { foo: 'bar' });
    const msg = parseMessage(wire);
    expect(msg).toBeNull();
  });
});

describe('Hash Key Conversion', () => {
  it('should convert hash to hex key', () => {
    const hash = new Uint8Array([0x00, 0x01, 0x0a, 0xff]);
    const key = hashToKey(hash);
    expect(key).toBe('00010aff');
  });

  it('should produce consistent keys', () => {
    const hash1 = new Uint8Array(32);
    hash1.fill(0xab);
    const hash2 = new Uint8Array(32);
    hash2.fill(0xab);

    expect(hashToKey(hash1)).toBe(hashToKey(hash2));
  });
});
