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
      ['run', '-p', 'hashtree-cli', '--release', '--', 'start', '--addr', `127.0.0.1:${RUST_SERVER_PORT}`, '--data-dir', tempDir],
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

  test('receives not-found response for missing content via WebSocket protocol', async () => {
    // This test verifies that the protocol works correctly:
    // - Client can send JSON request with { type: 'req', id, hash }
    // - Server responds with { type: 'res', id, hash, found: false } for missing content

    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);

    // Request a hash that doesn't exist
    const nonExistentHash = 'deadbeef'.repeat(8); // 64 char hex
    console.log('Requesting non-existent hash:', nonExistentHash.slice(0, 16));

    const data = await client.request(nonExistentHash, 2000);
    // Should return null (not found) - this verifies the protocol is working
    expect(data).toBeNull();

    client.close();
  });

  test('can send multiple requests in sequence', async () => {
    // Verify the protocol handles multiple sequential requests correctly
    const client = new TestWsClient();
    const connected = await client.connect(RUST_SERVER_URL);
    expect(connected).toBe(true);

    // Send multiple requests - all should get "not found" responses
    const hashes = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    ];

    for (const hash of hashes) {
      const data = await client.request(hash, 2000);
      expect(data).toBeNull(); // All should be not found
    }

    client.close();
  });

  test('JSON protocol format is correct', async () => {
    // Verify the JSON message format works correctly
    const ws = new WebSocket(RUST_SERVER_URL);
    ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Failed to connect'));
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    // Send a request and verify we get a properly formatted response
    const responsePromise = new Promise<{ type: string; id: number; hash: string; found: boolean }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Response timeout')), 5000);

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          clearTimeout(timeout);
          resolve(JSON.parse(event.data));
        }
      };
    });

    // Send request with specific ID
    const requestId = 123;
    const testHash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    ws.send(JSON.stringify({ type: 'req', id: requestId, hash: testHash }));

    const response = await responsePromise;
    ws.close();

    // Verify response format matches protocol spec
    expect(response.type).toBe('res');
    expect(response.id).toBe(requestId);
    expect(response.hash).toBe(testHash);
    expect(response.found).toBe(false);
  });
});
