/**
 * WebRTC peer connection for hashtree data exchange
 */
import type { Store, Hash } from '../types.js';
import { toHex, fromHex } from '../types.js';
import { sha256 } from '../hash.js';
import type {
  SignalingMessage,
  DataMessage,
  DataRequest,
  DataResponse,
  PeerId,
} from './types.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.iris.to:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Batch ICE candidates to reduce signaling messages
const ICE_BATCH_DELAY = 100; // ms to wait before sending batched candidates

interface PendingRequest {
  hash: string;
  resolve: (data: Uint8Array | null) => void;
  timeout: ReturnType<typeof setTimeout>;
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

  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private requestTimeout: number;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private candidateBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  private queuedRemoteCandidates: RTCIceCandidateInit[] = [];

  readonly createdAt: number;
  connectedAt?: number;

  constructor(options: {
    peerId: PeerId;
    direction: 'inbound' | 'outbound';
    localStore: Store | null;
    sendSignaling: (msg: SignalingMessage) => Promise<void>;
    onClose: () => void;
    onConnected?: () => void;
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
        this.onConnected?.();
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
      }
    } catch (err) {
      this.log('Error handling message:', err);
    }
  }

  private async handleBinaryMessage(data: ArrayBuffer): Promise<void> {
    // Binary data follows a response message
    // Format: [4 bytes requestId][data]
    const view = new DataView(data);
    const requestId = view.getUint32(0, true);
    const blobData = new Uint8Array(data, 4);

    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      // Verify hash
      const computedHash = await sha256(blobData);

      if (toHex(computedHash) === pending.hash) {
        pending.resolve(blobData);
      } else {
        this.log('Hash mismatch for request', requestId);
        pending.resolve(null);
      }
    }
  }

  private async handleRequest(msg: DataRequest): Promise<void> {
    if (!this.localStore) {
      this.sendResponse(msg.id, msg.hash, false);
      return;
    }

    const hash = fromHex(msg.hash);
    const data = await this.localStore.get(hash);

    if (data) {
      this.sendResponse(msg.id, msg.hash, true);
      this.sendBinaryData(msg.id, data);
    } else {
      this.sendResponse(msg.id, msg.hash, false);
    }
  }

  private async handleResponse(msg: DataResponse): Promise<void> {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    if (!msg.found) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.id);
      pending.resolve(null);
    }
    // If found, wait for binary data
  }

  private sendResponse(id: number, hash: string, found: boolean): void {
    const msg: DataResponse = { type: 'res', id, hash, found };
    this.sendJson(msg);
  }

  private sendBinaryData(requestId: number, data: Uint8Array): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    // Format: [4 bytes requestId][data]
    const packet = new Uint8Array(4 + data.length);
    const view = new DataView(packet.buffer);
    view.setUint32(0, requestId, true);
    packet.set(data, 4);

    this.dataChannel.send(packet.buffer);
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
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, this.requestTimeout);

      this.pendingRequests.set(requestId, { hash: hashHex, resolve, timeout });

      const msg: DataRequest = { type: 'req', id: requestId, hash: hashHex };
      this.sendJson(msg);
    });
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
    // Clear pending requests
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRequests.clear();

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
