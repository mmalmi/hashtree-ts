/**
 * Cross-language WebSocket integration test: hashtree-ts <-> hashtree-rs
 *
 * Tests that the TypeScript WebSocketPeer can communicate with the
 * Rust hashtree-rs /ws/data endpoint using the shared protocol:
 * - JSON messages: req, res
 * - Binary messages: [4-byte LE request_id][data]
 */

import { test, expect } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import WebSocket from 'ws';
import { createHash } from 'crypto';

// Polyfill WebSocket for Node.js environment
(globalThis as any).WebSocket = WebSocket;

const RUST_SERVER_PORT = 18787;
const RUST_SERVER_URL = `ws://127.0.0.1:${RUST_SERVER_PORT}/ws/data`;
const HTTP_URL = `http://127.0.0.1:${RUST_SERVER_PORT}`;

/**
 * Simple WebSocket client that speaks the hashtree protocol
 * (mirrors wsPeer.ts but simplified for testing)
 */
class TestWsClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<number, {
    hash: string;
    resolve: (data: Uint8Array | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private nextRequestId = 1;

  async connect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        const timeout = setTimeout(() => {
          this.ws?.close();
          resolve(false);
        }, 5000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          console.log('[TestWsClient] Connected');
          resolve(true);
        };

        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          console.log('[TestWsClient] Error:', err);
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handleJsonMessage(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            this.handleBinaryMessage(event.data);
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRequests.clear();
  }

  async request(hashHex: string, timeoutMs = 5000): Promise<Uint8Array | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    const requestId = this.nextRequestId++;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        console.log('[TestWsClient] Request timeout for', hashHex.slice(0, 16));
        resolve(null);
      }, timeoutMs);

      this.pendingRequests.set(requestId, { hash: hashHex, resolve, timeout });

      const msg = { type: 'req', id: requestId, hash: hashHex };
      this.ws!.send(JSON.stringify(msg));
      console.log('[TestWsClient] Sent request:', msg);
    });
  }

  private handleJsonMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      console.log('[TestWsClient] Received JSON:', msg);

      if (msg.type === 'res') {
        const pending = this.pendingRequests.get(msg.id);
        if (pending && !msg.found) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.id);
          pending.resolve(null);
        }
        // If found=true, wait for binary data
      }
    } catch (err) {
      console.log('[TestWsClient] Error parsing JSON:', err);
    }
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    // Parse: [4-byte LE request_id][payload]
    const view = new DataView(data);
    const requestId = view.getUint32(0, true); // little-endian
    const payload = new Uint8Array(data, 4);

    console.log('[TestWsClient] Received binary:', requestId, 'bytes:', payload.length);

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    // Verify hash
    const computedHash = createHash('sha256').update(payload).digest('hex');
    if (computedHash === pending.hash) {
      pending.resolve(payload);
    } else {
      console.log('[TestWsClient] Hash mismatch:', computedHash, 'expected:', pending.hash);
      pending.resolve(null);
    }
  }
}

test.describe('hashtree-rs WebSocket Integration', () => {
  test.setTimeout(60000);

  let rustProcess: ChildProcess | null = null;
  let tempDir: string | null = null;

  test.beforeAll(async () => {
    // Create temp directory for Rust server storage
    tempDir = execSync('mktemp -d').toString().trim();
    console.log('Temp directory:', tempDir);

    // Start hashtree-rs server
    console.log('Starting hashtree-rs server...');
    rustProcess = spawn(
      'cargo',
      ['run', '-p', 'hashtree-cli', '--release', '--', 'serve', '--port', RUST_SERVER_PORT.toString(), '--data-dir', tempDir],
      {
        cwd: '/workspace/hashtree-rs',
        env: { ...process.env, RUST_LOG: 'hashtree_cli=debug' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    // Log output
    rustProcess.stdout?.on('data', (data) => {
      console.log('[hashtree-rs stdout]', data.toString().trim());
    });
    rustProcess.stderr?.on('data', (data) => {
      console.log('[hashtree-rs stderr]', data.toString().trim());
    });

    // Wait for server to start
    let serverReady = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const response = await fetch(`${HTTP_URL}/api/stats`);
        if (response.ok) {
          serverReady = true;
          console.log('hashtree-rs server is ready');
          break;
        }
      } catch {
        // Server not ready yet
      }
    }

    if (!serverReady) {
      throw new Error('hashtree-rs server failed to start');
    }
  });

  test.afterAll(async () => {
    if (rustProcess) {
      rustProcess.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
      rustProcess.kill('SIGKILL');
    }
    if (tempDir) {
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('TypeScript WebSocketPeer can connect to hashtree-rs /ws/data', async () => {
    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);
    client.close();
  });

  test('can request content from hashtree-rs via WebSocket', async () => {
    // First, upload some content via HTTP
    const testContent = 'Hello from hashtree-rs WebSocket test!';
    const contentBytes = new TextEncoder().encode(testContent);
    const expectedHash = createHash('sha256').update(contentBytes).digest('hex');

    console.log('Uploading test content...');
    console.log('Expected hash:', expectedHash);

    // Upload via HTTP POST
    const uploadResponse = await fetch(`${HTTP_URL}/upload`, {
      method: 'POST',
      body: contentBytes,
    });
    expect(uploadResponse.ok).toBe(true);
    const uploadResult = await uploadResponse.text();
    console.log('Upload result:', uploadResult);

    // Now request via WebSocket
    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);

    const data = await client.request(expectedHash);
    expect(data).not.toBeNull();
    expect(new TextDecoder().decode(data!)).toBe(testContent);

    client.close();
  });

  test('returns null for non-existent hash', async () => {
    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);

    const nonExistentHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const data = await client.request(nonExistentHash, 2000);
    expect(data).toBeNull();

    client.close();
  });

  test('can request multiple items in sequence', async () => {
    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);

    // Upload several items
    const items = ['Item 1', 'Item 2', 'Item 3'];
    const hashes: string[] = [];

    for (const item of items) {
      const bytes = new TextEncoder().encode(item);
      const hash = createHash('sha256').update(bytes).digest('hex');
      hashes.push(hash);

      const response = await fetch(`${HTTP_URL}/upload`, {
        method: 'POST',
        body: bytes,
      });
      expect(response.ok).toBe(true);
    }

    // Request them all via WebSocket
    for (let i = 0; i < items.length; i++) {
      const data = await client.request(hashes[i]);
      expect(data).not.toBeNull();
      expect(new TextDecoder().decode(data!)).toBe(items[i]);
    }

    client.close();
  });

  test('binary message format matches protocol spec', async () => {
    // This test verifies the binary message format:
    // [4-byte LE request_id][data]

    const testContent = 'Protocol format test';
    const contentBytes = new TextEncoder().encode(testContent);
    const expectedHash = createHash('sha256').update(contentBytes).digest('hex');

    // Upload
    await fetch(`${HTTP_URL}/upload`, {
      method: 'POST',
      body: contentBytes,
    });

    // Connect and capture raw binary message
    const ws = new WebSocket(RUST_SERVER_URL);
    ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Failed to connect'));
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const binaryMessage = await new Promise<ArrayBuffer>((resolve, reject) => {
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          resolve(event.data);
        }
      };

      const timeout = setTimeout(() => reject(new Error('No binary response')), 5000);

      // Listen for JSON response first
      const originalOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'res' && !msg.found) {
            clearTimeout(timeout);
            reject(new Error('Content not found'));
          }
        } else {
          clearTimeout(timeout);
          originalOnMessage?.call(ws, event);
        }
      };

      // Send request with known ID
      const requestId = 42;
      ws.send(JSON.stringify({ type: 'req', id: requestId, hash: expectedHash }));
    });

    ws.close();

    // Verify format
    const view = new DataView(binaryMessage);
    const requestId = view.getUint32(0, true); // little-endian
    expect(requestId).toBe(42);

    const payload = new Uint8Array(binaryMessage, 4);
    expect(new TextDecoder().decode(payload)).toBe(testContent);
  });
});
