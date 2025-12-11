/**
 * WebRTC peer connection for hashtree data exchange
 */
import type { Store, Hash } from '../types.js';
import type {
  SignalingMessage,
  DataRequest,
  PeerId,
} from './types.js';
import { MAX_HTL, MSG_TYPE_REQUEST, MSG_TYPE_RESPONSE } from './types.js';
import { LRUCache } from './lruCache.js';
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
  shouldForward,
  hashToKey,
} from './protocol.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.iris.to:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Batch ICE candidates to reduce signaling messages
const ICE_BATCH_DELAY = 100; // ms to wait before sending batched candidates

// Default LRU cache size
const THEIR_REQUESTS_SIZE = 200;

// Request this peer sent us that we couldn't fulfill locally
// We track it so we can push data back when/if we get it
interface TheirRequest {
  hash: Uint8Array;
  requestedAt: number;
}

export class Peer {
  readonly peerId: string;
  readonly pubkey: string;
  readonly direction: 'inbound' | 'outbound';

  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private localStore: Store | null;
  private sendSignaling: (msg: SignalingMessage) => Promise<void>;
  private onClose: () => void;
  private onConnected?: () => void;
  private debug: boolean;

  // Requests we sent TO this peer (keyed by hash hex)
  private ourRequests = new Map<string, PendingRequest>();
  // Requests this peer sent TO US that we couldn't fulfill (keyed by hash hex)
  // We track these so we can push data back if we get it later
  private theirRequests = new LRUCache<string, TheirRequest>(THEIR_REQUESTS_SIZE);

  private requestTimeout: number;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private candidateBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  // Callback to forward request to other peers when we don't have data locally
  // htl parameter is the decremented HTL to use when forwarding
  private onForwardRequest?: (hash: Uint8Array, excludePeerId: string, htl: number) => Promise<Uint8Array | null>;

  // Per-peer HTL decrement config (Freenet-style probabilistic)
  private htlConfig: PeerHTLConfig;

  readonly createdAt: number;
  connectedAt?: number;

  constructor(options: {
    peerId: PeerId;
    direction: 'inbound' | 'outbound';
    localStore: Store | null;
    sendSignaling: (msg: SignalingMessage) => Promise<void>;
    onClose: () => void;
    onConnected?: () => void;
    onForwardRequest?: (hash: Uint8Array, excludePeerId: string, htl: number) => Promise<Uint8Array | null>;
    requestTimeout?: number;
    debug?: boolean;
  }) {
    this.peerId = options.peerId.toString();
    this.pubkey = options.peerId.pubkey;
    this.direction = options.direction;
    this.localStore = options.localStore;
    this.sendSignaling = options.sendSignaling;
    this.onClose = options.onClose;
    this.onConnected = options.onConnected;
    this.onForwardRequest = options.onForwardRequest;
    this.requestTimeout = options.requestTimeout ?? 5000;
    this.debug = options.debug ?? false;
    this.createdAt = Date.now();
    // Generate random HTL config for this peer (Freenet-style)
    this.htlConfig = generatePeerHTLConfig();

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.setupPeerConnection();
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[Peer ${this.peerId.slice(0, 12)}]`, ...args);
    }
  }

  get state(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  get isConnected(): boolean {
    return this.pc.connectionState === 'connected';
  }

  private scheduleCandidateBatch(): void {
    if (this.candidateBatchTimeout) return;

    this.candidateBatchTimeout = setTimeout(() => {
      this.candidateBatchTimeout = null;
      if (this.pendingCandidates.length > 0) {
        const candidates = this.pendingCandidates;
        this.pendingCandidates = [];

        // Send as batch
        this.sendSignaling({
          type: 'candidates',
          candidates,
          recipient: this.peerId,
          peerId: '', // Will be set by caller
        }).catch((err) => {
          this.log('Failed to send candidates batch:', err);
        });
      }
    }, ICE_BATCH_DELAY);
  }

  private setupPeerConnection(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.pendingCandidates.push(event.candidate.toJSON());
        this.scheduleCandidateBatch();
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.log('Connection state:', this.pc.connectionState);

      if (this.pc.connectionState === 'connected') {
        this.connectedAt = Date.now();
        this.onConnected?.();
      } else if (
        this.pc.connectionState === 'failed' ||
        this.pc.connectionState === 'closed' ||
        this.pc.connectionState === 'disconnected'
      ) {
        this.close();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.log('Data channel open');
    };

    channel.onclose = () => {
      this.log('Data channel closed');
      this.close();
    };

    channel.onmessage = async (event) => {
      // All messages are binary with type prefix
      if (event.data instanceof ArrayBuffer) {
        await this.handleMessage(event.data);
      }
    };
  }

  private async handleMessage(data: ArrayBuffer): Promise<void> {
    const msg = parseMessage(data);
    if (!msg) {
      this.log('Failed to parse message');
      return;
    }

    if (msg.type === MSG_TYPE_REQUEST) {
      await this.handleRequest(msg.body);
    } else if (msg.type === MSG_TYPE_RESPONSE) {
      await handleResponse(msg.body, this.ourRequests);
    }
  }

  private async handleRequest(req: DataRequest): Promise<void> {
    const htl = req.htl ?? MAX_HTL;
    const hash = req.h;
    const hashKey = hashToKey(hash);

    // Try local store first
    if (this.localStore) {
      const data = await this.localStore.get(hash);

      if (data) {
        this.sendResponse(hash, data);
        return;
      }
    }

    // Not found locally - check if we should forward based on HTL
    if (this.onForwardRequest && shouldForward(htl)) {
      // Track this request so we can push data back later if we get it
      this.theirRequests.set(hashKey, {
        hash,
        requestedAt: Date.now(),
      });

      // Decrement HTL before forwarding (Freenet-style per-peer decrement)
      const forwardHTL = decrementHTL(htl, this.htlConfig);

      // Forward to other peers (excluding this one)
      const data = await this.onForwardRequest(hash, this.peerId, forwardHTL);

      if (data) {
        // Got it from another peer, send response
        this.theirRequests.delete(hashKey);
        this.sendResponse(hash, data);
        return;
      }
      // If not found, keep in theirRequests for later push
    }

    // Not found anywhere - stay silent, let requester timeout.
  }

  private sendResponse(hash: Uint8Array, data: Uint8Array): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    const res = createResponse(hash, data);
    this.dataChannel.send(encodeResponse(res));
  }

  /**
   * Request data by hash from this peer
   * @param htl Hops To Live - decremented before sending
   */
  async request(hash: Hash, htl: number = MAX_HTL): Promise<Uint8Array | null> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return null;
    }

    const hashKey = hashToKey(hash);

    // Check if we already have a pending request for this hash
    const existing = this.ourRequests.get(hashKey);
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
        this.ourRequests.delete(hashKey);
        resolve(null);
      }, this.requestTimeout);

      this.ourRequests.set(hashKey, { hash, resolve, timeout });

      const req = createRequest(hash, sendHTL);
      this.dataChannel!.send(encodeRequest(req));
    });
  }

  /**
   * Send data to this peer for a hash they previously requested
   * Returns true if this peer had requested this hash
   */
  sendData(hash: Uint8Array, data: Uint8Array): boolean {
    const hashKey = hashToKey(hash);
    const theirReq = this.theirRequests.get(hashKey);
    if (!theirReq) {
      return false;
    }

    this.theirRequests.delete(hashKey);

    // Send response with data
    this.sendResponse(hash, data);

    this.log('Sent data for hash:', hashKey.slice(0, 16));
    return true;
  }

  /**
   * Check if this peer has requested a hash
   */
  hasRequested(hash: Uint8Array): boolean {
    return this.theirRequests.has(hashToKey(hash));
  }

  /**
   * Get count of pending requests from this peer
   */
  getTheirRequestCount(): number {
    return this.theirRequests.size;
  }

  /**
   * Initiate connection (create offer)
   */
  async connect(myPeerId: string): Promise<void> {
    // Unordered for better performance - protocol is stateless (each message self-describes)
    this.dataChannel = this.pc.createDataChannel('hashtree', { ordered: false });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await this.sendSignaling({
      type: 'offer',
      offer: offer,
      recipient: this.peerId,
      peerId: myPeerId,
    });
  }

  /**
   * Handle incoming signaling message
   */
  async handleSignaling(msg: SignalingMessage, myPeerId: string): Promise<void> {
    if (msg.type === 'offer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
      await this.processQueuedCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      await this.sendSignaling({
        type: 'answer',
        answer: answer,
        recipient: this.peerId,
        peerId: myPeerId,
      });
    } else if (msg.type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
      await this.processQueuedCandidates();
    } else if (msg.type === 'candidate') {
      await this.addRemoteCandidate(msg.candidate);
    } else if (msg.type === 'candidates') {
      // Handle batched candidates
      for (const candidate of msg.candidates) {
        await this.addRemoteCandidate(candidate);
      }
    }
  }

  private async addRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Queue candidates if remote description not set yet
    if (!this.pc.remoteDescription) {
      this.queuedRemoteCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      this.log('Failed to add ICE candidate:', err);
    }
  }

  private async processQueuedCandidates(): Promise<void> {
    const candidates = this.queuedRemoteCandidates;
    this.queuedRemoteCandidates = [];

    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        this.log('Failed to add queued ICE candidate:', err);
      }
    }
  }

  /**
   * Close the peer connection
   */
  close(): void {
    if (this.candidateBatchTimeout) {
      clearTimeout(this.candidateBatchTimeout);
      this.candidateBatchTimeout = null;
    }

    clearPendingRequests(this.ourRequests);

    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
      this.dataChannel = null;
    }

    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ondatachannel = null;
    this.pc.close();

    this.onClose();
  }
}
