/**
 * WebSocket peer for hashtree data exchange
 *
 * Speaks the same protocol as WebRTC data channels:
 * Wire format: [type byte][msgpack body]
 * Request:  [0x00][msgpack: {h: bytes32, htl?: u8}]
 * Response: [0x01][msgpack: {h: bytes32, d: bytes}]
 *
 * Used as a fallback when WebRTC connections fail.
 * Can both request data AND respond to incoming requests from the server.
 */
import type { Store, Hash } from '../types.js';
import type { DataRequest, DataResponse } from './types.js';
import { MAX_HTL, MSG_TYPE_REQUEST, MSG_TYPE_RESPONSE } from './types.js';
import {
  PendingRequest,
  PeerHTLConfig,
  encodeRequest,
  encodeResponse,
  parseMessage,
  createRequest,
  createResponse,
  handleResponse,
  clearPendingRequests,
  generatePeerHTLConfig,
  decrementHTL,
  hashToKey,
} from './protocol.js';

export class WebSocketPeer {
  private ws: WebSocket | null = null;
  private url: string;
  private localStore: Store | null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestTimeout: number;
  private debug: boolean;
  private connected = false;
  private connecting = false;
  private connectPromise: Promise<boolean> | null = null;
  private reconnectInterval = 1000; // Start at 1s
  private maxReconnectInterval = 15000; // Max 15s
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private onStatusChange: (() => void) | null = null;

  // Per-peer HTL decrement config (Freenet-style probabilistic)
  private htlConfig: PeerHTLConfig;

  constructor(options: {
    url: string;
    localStore?: Store | null;
    requestTimeout?: number;
    debug?: boolean;
    onStatusChange?: () => void;
  }) {
    this.url = options.url;
    this.localStore = options.localStore ?? null;
    this.requestTimeout = options.requestTimeout ?? 5000;
    this.debug = options.debug ?? false;
    this.onStatusChange = options.onStatusChange ?? null;
    // Generate random HTL config for this peer (Freenet-style)
    this.htlConfig = generatePeerHTLConfig();
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
            this.onStatusChange?.();
            // Schedule reconnect on timeout
            if (this.shouldReconnect) {
              this.reconnectInterval = Math.min(
                this.reconnectInterval * 1.5,
                this.maxReconnectInterval
              );
              this.scheduleReconnect();
            }
            resolve(false);
          }
        }, 5000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.connected = true;
          this.connecting = false;
          this.reconnectInterval = 1000; // Reset on successful connection
          this.log('Connected');
          this.onStatusChange?.();
          resolve(true);
        };

        this.ws.onclose = () => {
          clearTimeout(connectTimeout);
          const wasConnected = this.connected;
          this.connected = false;
          this.connecting = false;
          this.log('Disconnected');
          clearPendingRequests(this.pendingRequests);
          this.onStatusChange?.();
          // Schedule reconnect if we were connected or this wasn't the initial connect
          if (wasConnected && this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (err) => {
          clearTimeout(connectTimeout);
          this.log('Error:', err);
          this.connected = false;
          this.connecting = false;
          this.onStatusChange?.();
          // Schedule reconnect on error
          if (this.shouldReconnect) {
            this.reconnectInterval = Math.min(
              this.reconnectInterval * 1.5,
              this.maxReconnectInterval
            );
            this.scheduleReconnect();
          }
          resolve(false);
        };

        this.ws.onmessage = async (event) => {
          // All messages are binary with type prefix
          if (event.data instanceof ArrayBuffer) {
            await this.handleMessage(event.data);
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
   * Schedule a reconnect with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimeout) return;

    this.log(`Scheduling reconnect in ${this.reconnectInterval}ms`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect && !this.connected && !this.connecting) {
        this.log('Attempting reconnect...');
        this.connect().then(success => {
          if (!success && this.shouldReconnect) {
            // Increase interval for next attempt (exponential backoff)
            this.reconnectInterval = Math.min(
              this.reconnectInterval * 1.5,
              this.maxReconnectInterval
            );
            this.scheduleReconnect();
          }
        });
      }
    }, this.reconnectInterval);
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
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
   * @param htl Hops To Live - decremented before sending
   */
  async request(hash: Hash, htl: number = MAX_HTL): Promise<Uint8Array | null> {
    if (!this.isConnected) {
      const connected = await this.connect();
      if (!connected) return null;
    }

    const hashKey = hashToKey(hash);

    // Check if we already have a pending request for this hash
    const existing = this.pendingRequests.get(hashKey);
    if (existing) {
      // Return a new promise that resolves when the existing one does
      return new Promise((resolve) => {
        const originalResolve = existing.resolve;
        existing.resolve = (data) => {
          originalResolve(data);
          resolve(data);
        };
      });
    }

    // Decrement HTL before sending (Freenet-style per-peer decrement)
    const sendHTL = decrementHTL(htl, this.htlConfig);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(hashKey);
        this.log('Request timeout for', hashKey.slice(0, 16));
        resolve(null);
      }, this.requestTimeout);

      this.pendingRequests.set(hashKey, { hash, resolve, timeout });

      const req = createRequest(hash, sendHTL);
      this.ws!.send(encodeRequest(req));
    });
  }

  private async handleMessage(data: ArrayBuffer): Promise<void> {
    const msg = parseMessage(data);
    if (!msg) {
      this.log('Failed to parse message');
      return;
    }

    if (msg.type === MSG_TYPE_RESPONSE) {
      await handleResponse(msg.body as DataResponse, this.pendingRequests);
    } else if (msg.type === MSG_TYPE_REQUEST) {
      // Server is forwarding a request from another peer
      await this.handleRequest(msg.body as DataRequest);
    }
  }

  /**
   * Handle incoming request from server (forwarded from another peer)
   */
  private async handleRequest(req: DataRequest): Promise<void> {
    if (!this.localStore) {
      // No local store - stay silent, let server try next peer
      this.log('Request for', hashToKey(req.h).slice(0, 16), '- no local store');
      return;
    }

    const data = await this.localStore.get(req.h);

    if (data) {
      // We have it - send response with data
      this.log('Serving', hashToKey(req.h).slice(0, 16));
      this.sendResponse(req.h, data);
    }
    // If we don't have it, stay silent - server will timeout and try next peer
  }

  private sendResponse(hash: Uint8Array, data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const res = createResponse(hash, data);
    this.ws.send(encodeResponse(res));
  }
}
