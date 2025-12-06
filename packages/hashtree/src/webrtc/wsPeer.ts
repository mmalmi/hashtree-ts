/**
 * WebSocket peer for hashtree data exchange
 *
 * Speaks the same protocol as WebRTC data channels:
 * - JSON messages: req, res, push, have, want, root
 * - Binary messages: [4-byte LE request_id][data]
 *
 * Used as a fallback when WebRTC connections fail.
 */
import type { Hash } from '../types.js';
import { toHex } from '../types.js';
import type { DataRequest, DataResponse } from './types.js';
import {
  PendingRequest,
  handleBinaryResponse,
  handleResponseMessage,
  createRequest,
  clearPendingRequests,
} from './protocol.js';

export class WebSocketPeer {
  private ws: WebSocket | null = null;
  private url: string;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private requestTimeout: number;
  private debug: boolean;
  private connected = false;
  private connecting = false;
  private connectPromise: Promise<boolean> | null = null;

  constructor(options: {
    url: string;
    requestTimeout?: number;
    debug?: boolean;
  }) {
    this.url = options.url;
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
      }
      // Other message types (have, want, root) can be added as needed
    } catch (err) {
      this.log('Error handling message:', err);
    }
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
