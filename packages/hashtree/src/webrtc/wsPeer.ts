/**
 * WebSocket peer for hashtree data exchange
 *
 * Speaks the same protocol as WebRTC data channels:
 * - JSON messages: req, res, push, have, want, root
 * - Binary messages: [4-byte LE request_id][data]
 *
 * Used as a fallback when WebRTC connections fail.
 * Can both request data AND respond to incoming requests from the server.
 */
import type { Store, Hash } from '../types.js';
import { toHex, fromHex } from '../types.js';
import type { DataRequest, DataResponse } from './types.js';
import {
  PendingRequest,
  handleBinaryResponse,
  handleResponseMessage,
  createRequest,
  createResponse,
  createBinaryMessage,
  clearPendingRequests,
} from './protocol.js';

export class WebSocketPeer {
  private ws: WebSocket | null = null;
  private url: string;
  private localStore: Store | null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private requestTimeout: number;
  private debug: boolean;
  private connected = false;
  private connecting = false;
  private connectPromise: Promise<boolean> | null = null;

  constructor(options: {
    url: string;
    localStore?: Store | null;
    requestTimeout?: number;
    debug?: boolean;
  }) {
    this.url = options.url;
    this.localStore = options.localStore ?? null;
    this.requestTimeout = options.requestTimeout ?? 5000;
    this.debug = options.debug ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[WsPeer ${this.url}]`, ...args);
    }
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting && this.connectPromise) {
      return this.connectPromise;
    }

    this.connecting = true;
    this.connectPromise = new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
          if (!this.connected) {
            this.log('Connection timeout');
            this.ws?.close();
            this.connecting = false;
            resolve(false);
          }
        }, 5000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.connected = true;
          this.connecting = false;
          this.log('Connected');
          resolve(true);
        };

        this.ws.onclose = () => {
          clearTimeout(connectTimeout);
          this.connected = false;
          this.connecting = false;
          this.log('Disconnected');
          clearPendingRequests(this.pendingRequests);
        };

        this.ws.onerror = (err) => {
          clearTimeout(connectTimeout);
          this.log('Error:', err);
          this.connected = false;
          this.connecting = false;
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handleJsonMessage(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            this.handleBinaryMessage(event.data);
          }
        };
      } catch (err) {
        this.log('Failed to connect:', err);
        this.connecting = false;
        resolve(false);
      }
    });

    return this.connectPromise;
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;

    clearPendingRequests(this.pendingRequests);
  }

  /**
   * Request data by hash
   */
  async request(hash: Hash): Promise<Uint8Array | null> {
    if (!this.isConnected) {
      const connected = await this.connect();
      if (!connected) return null;
    }

    const hashHex = toHex(hash);
    const requestId = this.nextRequestId++;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.log('Request timeout for', hashHex.slice(0, 16));
        resolve(null);
      }, this.requestTimeout);

      this.pendingRequests.set(requestId, { hash: hashHex, resolve, timeout });

      const msg = createRequest(requestId, hashHex);
      this.sendJson(msg);
    });
  }

  private handleJsonMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'res') {
        handleResponseMessage(msg as DataResponse, this.pendingRequests);
      } else if (msg.type === 'req') {
        // Server is forwarding a request from another peer
        this.handleRequest(msg as DataRequest);
      }
      // Other message types (have, want, root) can be added as needed
    } catch (err) {
      this.log('Error handling message:', err);
    }
  }

  /**
   * Handle incoming request from server (forwarded from another peer)
   */
  private async handleRequest(msg: DataRequest): Promise<void> {
    if (!this.localStore) {
      // No local store - stay silent, let server try next peer
      this.log('Request for', msg.hash.slice(0, 16), '- no local store');
      return;
    }

    const hash = fromHex(msg.hash);
    const data = await this.localStore.get(hash);

    if (data) {
      // We have it - send response and data
      this.log('Serving', msg.hash.slice(0, 16));
      this.sendResponse(msg.id, msg.hash, true);
      this.sendBinaryData(msg.id, data);
    }
    // If we don't have it, stay silent - server will timeout and try next peer
    // (We don't send "not found" responses to save bandwidth)
  }

  private sendResponse(id: number, hash: string, found: boolean): void {
    const msg = createResponse(id, hash, found);
    this.sendJson(msg);
  }

  private sendBinaryData(requestId: number, data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(createBinaryMessage(requestId, data));
  }

  private async handleBinaryMessage(data: ArrayBuffer): Promise<void> {
    await handleBinaryResponse(
      data,
      this.pendingRequests,
      (requestId) => this.log('Hash mismatch for request', requestId),
    );
  }

  private sendJson(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }
}
