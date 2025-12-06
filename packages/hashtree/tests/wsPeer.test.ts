import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sha256 } from '../src/hash.js';
import { toHex } from '../src/types.js';

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
  it('should construct with options', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 3000,
      debug: true,
    });

    expect(peer.isConnected).toBe(false);
  });

  it('should connect and report connected state', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
    });

    const connectPromise = peer.connect();

    // Simulate successful connection
    setTimeout(() => {
      mockWs?.simulateOpen();
    }, 10);

    const result = await connectPromise;
    expect(result).toBe(true);
    expect(peer.isConnected).toBe(true);
  });

  it('should handle connection error', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
    });

    const connectPromise = peer.connect();

    // Simulate error
    setTimeout(() => {
      mockWs?.simulateError(new Error('Connection refused'));
    }, 10);

    const result = await connectPromise;
    expect(result).toBe(false);
    expect(peer.isConnected).toBe(false);
  });

  it('should send request in correct format', async () => {
    const { WebSocketPeer } = await import('../src/webrtc/wsPeer.js');

    const peer = new WebSocketPeer({
      url: 'ws://localhost:8080/ws/data',
      requestTimeout: 1000,
    });

    // Connect first
    const connectPromise = peer.connect();
    setTimeout(() => mockWs?.simulateOpen(), 10);
    await connectPromise;

    // Send a request
    const testData = new TextEncoder().encode('hello');
    const hash = await sha256(testData);

    // Start request (don't await - it will timeout)
    const requestPromise = peer.request(hash);

    // Give it time to send the request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check sent message
    const sentMessages = mockWs?.getSentMessages() ?? [];
    expect(sentMessages.length).toBe(1);

    const msg = JSON.parse(sentMessages[0] as string);
    expect(msg.type).toBe('req');
    expect(msg.id).toBe(1);
    expect(msg.hash).toBe(toHex(hash));

    // Let request timeout
    const result = await requestPromise;
    expect(result).toBeNull();
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
    const hashHex = toHex(hash);

    // Start request
    const requestPromise = peer.request(hash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate response
    const response = { type: 'res', id: 1, hash: hashHex, found: true };
    mockWs?.simulateMessage(JSON.stringify(response));

    // Simulate binary data
    const binaryPacket = new ArrayBuffer(4 + testData.length);
    const view = new DataView(binaryPacket);
    view.setUint32(0, 1, true); // request id = 1, little endian
    new Uint8Array(binaryPacket, 4).set(testData);
    mockWs?.simulateMessage(binaryPacket);

    // Await result
    const result = await requestPromise;

    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!)).toBe('hello world');
  });

  it('should handle not found response', async () => {
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
    const testData = new TextEncoder().encode('missing');
    const hash = await sha256(testData);
    const hashHex = toHex(hash);

    // Start request
    const requestPromise = peer.request(hash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate not found response
    const response = { type: 'res', id: 1, hash: hashHex, found: false };
    mockWs?.simulateMessage(JSON.stringify(response));

    // Await result
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
    const hashHex = toHex(expectedHash);

    // Start request
    const requestPromise = peer.request(expectedHash);

    // Wait for request to be sent
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate response
    const response = { type: 'res', id: 1, hash: hashHex, found: true };
    mockWs?.simulateMessage(JSON.stringify(response));

    // Send wrong data
    const wrongData = new TextEncoder().encode('wrong data');
    const binaryPacket = new ArrayBuffer(4 + wrongData.length);
    const view = new DataView(binaryPacket);
    view.setUint32(0, 1, true);
    new Uint8Array(binaryPacket, 4).set(wrongData);
    mockWs?.simulateMessage(binaryPacket);

    // Should be rejected due to hash mismatch
    const result = await requestPromise;
    expect(result).toBeNull();
  });
});

describe('Data Protocol Compatibility', () => {
  it('should format binary packet with little-endian request ID', () => {
    const requestId = 0x12345678;
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    const packet = new ArrayBuffer(4 + data.length);
    const view = new DataView(packet);
    view.setUint32(0, requestId, true); // little endian
    new Uint8Array(packet, 4).set(data);

    // Verify
    const bytes = new Uint8Array(packet);
    expect(bytes[0]).toBe(0x78); // LSB first
    expect(bytes[1]).toBe(0x56);
    expect(bytes[2]).toBe(0x34);
    expect(bytes[3]).toBe(0x12); // MSB last
    expect(bytes.slice(4)).toEqual(data);
  });

  it('should parse binary packet correctly', () => {
    const requestId = 42;
    const data = new TextEncoder().encode('test data');

    // Create packet like server would send
    const packet = new ArrayBuffer(4 + data.length);
    const view = new DataView(packet);
    view.setUint32(0, requestId, true);
    new Uint8Array(packet, 4).set(data);

    // Parse like client
    const parsedId = new DataView(packet).getUint32(0, true);
    const parsedData = new Uint8Array(packet, 4);

    expect(parsedId).toBe(42);
    expect(new TextDecoder().decode(parsedData)).toBe('test data');
  });
});
