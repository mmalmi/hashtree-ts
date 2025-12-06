/**
 * WebRTC peer connection for hashtree data exchange
 */
import type { Store, Hash } from '../types.js';
import { toHex, fromHex } from '../types.js';
import type {
  SignalingMessage,
  DataMessage,
  DataRequest,
  DataResponse,
  DataPush,
  PeerId,
} from './types.js';
import { LRUCache } from './lruCache.js';
import {
  PendingRequest,
  createBinaryMessage,
  handleBinaryResponse,
  handleResponseMessage,
  createRequest,
  createResponse,
  clearPendingRequests,
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
  id: number;           // their request id
  requestedAt: number;  // when they requested it
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

  // Requests we sent TO this peer (keyed by our request id)
  private ourRequests = new Map<number, PendingRequest>();
  // Requests this peer sent TO US that we couldn't fulfill (keyed by hash hex)
  // We track these so we can push data back if we get it later
  private theirRequests = new LRUCache<string, TheirRequest>(THEIR_REQUESTS_SIZE);

  private nextRequestId = 1;
  private requestTimeout: number;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private candidateBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  // Callback to forward request to other peers when we don't have data locally
  private onForwardRequest?: (hash: string, excludePeerId: string) => Promise<Uint8Array | null>;

  readonly createdAt: number;
  connectedAt?: number;

  constructor(options: {
    peerId: PeerId;
    direction: 'inbound' | 'outbound';
    localStore: Store | null;
    sendSignaling: (msg: SignalingMessage) => Promise<void>;
    onClose: () => void;
    onConnected?: () => void;
    onForwardRequest?: (hash: string, excludePeerId: string) => Promise<Uint8Array | null>;
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
        const candidates = this.pendingCandidates.splice(0);
        this.log(`Sending ${candidates.length} batched ICE candidates`);
        this.sendSignaling({
          type: 'candidates',
          candidates,
          recipient: this.peerId,
          peerId: '', // filled by manager
        });
      }
    }, ICE_BATCH_DELAY);
  }

  private setupPeerConnection(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Batch ICE candidates to reduce signaling messages
        this.pendingCandidates.push(event.candidate.toJSON());
        this.scheduleCandidateBatch();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.log('Received data channel');
      this.setupDataChannel(event.channel);
    };

    this.pc.onconnectionstatechange = () => {
      this.log('Connection state:', this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        this.connectedAt = Date.now();
      }
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.close();
      }
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.log('Data channel open');
      // Only fire onConnected when data channel is actually ready for use
      this.onConnected?.();
    };

    channel.onclose = () => {
      this.log('Data channel closed');
      this.close();
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        await this.handleJsonMessage(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        await this.handleBinaryMessage(event.data);
      }
    };
  }

  private async handleJsonMessage(data: string): Promise<void> {
    try {
      const msg = JSON.parse(data) as DataMessage;

      if (msg.type === 'req') {
        await this.handleRequest(msg);
      } else if (msg.type === 'res') {
        await this.handleResponse(msg);
      } else if (msg.type === 'push') {
        await this.handlePush(msg);
      }
    } catch (err) {
      this.log('Error handling message:', err);
    }
  }

  private async handleBinaryMessage(data: ArrayBuffer): Promise<void> {
    await handleBinaryResponse(
      data,
      this.ourRequests,
      (requestId) => this.log('Hash mismatch for request', requestId),
    );
  }

  private async handleRequest(msg: DataRequest): Promise<void> {
    // Try local store first
    if (this.localStore) {
      const hash = fromHex(msg.hash);
      const data = await this.localStore.get(hash);

      if (data) {
        this.sendResponse(msg.id, msg.hash, true);
        this.sendBinaryData(msg.id, data);
        return;
      }
    }

    // Not found locally - try forwarding to other peers
    if (this.onForwardRequest) {
      // Track this request so we can push data back later if we get it
      this.theirRequests.set(msg.hash, {
        id: msg.id,
        requestedAt: Date.now(),
      });

      // Forward to other peers (excluding this one)
      const data = await this.onForwardRequest(msg.hash, this.peerId);

      if (data) {
        // Got it from another peer, send response
        this.theirRequests.delete(msg.hash);
        this.sendResponse(msg.id, msg.hash, true);
        this.sendBinaryData(msg.id, data);
        return;
      }
      // If not found, keep in theirRequests for later push
    }

    // Not found anywhere
    this.sendResponse(msg.id, msg.hash, false);
  }

  private async handleResponse(msg: DataResponse): Promise<void> {
    handleResponseMessage(msg, this.ourRequests);
    // If found, handleResponseMessage does nothing and we wait for binary data
  }

  private async handlePush(msg: DataPush): Promise<void> {
    // Peer is pushing data we previously requested but they didn't have
    // This happens when they got it later from another peer
    this.log('Received push for hash:', msg.hash.slice(0, 16));
    // The binary data will follow - we need to handle it
    // For now, just store it locally if we have a store
    // The actual binary handling happens in handleBinaryMessage with id=0
  }

  private sendResponse(id: number, hash: string, found: boolean): void {
    const msg = createResponse(id, hash, found);
    this.sendJson(msg);
  }

  private sendBinaryData(requestId: number, data: Uint8Array): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    this.dataChannel.send(createBinaryMessage(requestId, data));
  }

  private sendJson(msg: DataMessage): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    this.dataChannel.send(JSON.stringify(msg));
  }

  /**
   * Request data by hash from this peer
   */
  async request(hash: Hash): Promise<Uint8Array | null> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return null;
    }

    const hashHex = toHex(hash);
    const requestId = this.nextRequestId++;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.ourRequests.delete(requestId);
        resolve(null);
      }, this.requestTimeout);

      this.ourRequests.set(requestId, { hash: hashHex, resolve, timeout });

      const msg = createRequest(requestId, hashHex);
      this.sendJson(msg);
    });
  }

  /**
   * Send data to this peer for a hash they previously requested
   * Returns true if this peer had requested this hash
   */
  sendData(hashHex: string, data: Uint8Array): boolean {
    const theirReq = this.theirRequests.get(hashHex);
    if (!theirReq) {
      return false;
    }

    this.theirRequests.delete(hashHex);

    // Send push message followed by binary data
    const msg: DataPush = { type: 'push', hash: hashHex };
    this.sendJson(msg);
    this.sendBinaryData(theirReq.id, data);

    this.log('Sent data for hash:', hashHex.slice(0, 16));
    return true;
  }

  /**
   * Check if this peer has requested a hash
   */
  hasRequested(hashHex: string): boolean {
    return this.theirRequests.has(hashHex);
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
    this.dataChannel = this.pc.createDataChannel('hashtree');
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
      this.log(`Received ${msg.candidates.length} batched ICE candidates`);
    }
  }

  /**
   * Add a remote ICE candidate, queuing if remote description not yet set
   */
  private async addRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      // Queue candidates until remote description is set
      this.queuedRemoteCandidates.push(candidate);
      this.log('Queued ICE candidate (remote description not set yet)');
    }
  }

  /**
   * Process any queued ICE candidates after remote description is set
   */
  private async processQueuedCandidates(): Promise<void> {
    if (this.queuedRemoteCandidates.length > 0) {
      this.log(`Processing ${this.queuedRemoteCandidates.length} queued ICE candidates`);
      for (const candidate of this.queuedRemoteCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.queuedRemoteCandidates = [];
    }
  }

  /**
   * Close connection
   */
  close(): void {
    // Clear our pending requests
    clearPendingRequests(this.ourRequests);

    // Clear their requests (they won't get responses)
    this.theirRequests.clear();

    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
      this.dataChannel = null;
    }

    // Close peer connection
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();

    this.onClose();
  }
}
