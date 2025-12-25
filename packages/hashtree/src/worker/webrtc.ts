/**
 * Worker WebRTC Controller
 *
 * Controls WebRTC connections from the worker thread.
 * Main thread proxy executes RTCPeerConnection operations.
 *
 * Worker owns:
 * - Peer state tracking
 * - Connection lifecycle decisions
 * - Data protocol (request/response)
 * - Signaling message handling
 *
 * Main thread proxy owns:
 * - RTCPeerConnection instances (not available in workers)
 * - Data channel I/O
 */

import type { Store } from '../types.js';
import type { WebRTCCommand, WebRTCEvent } from './protocol.js';
import type { SignalingMessage, PeerPool, DataRequest, DataResponse } from '../webrtc/types.js';
import {
  MAX_HTL,
  MSG_TYPE_REQUEST,
  MSG_TYPE_RESPONSE,
  FRAGMENT_SIZE,
  PeerId,
  generateUuid,
} from '../webrtc/types.js';
import {
  encodeRequest,
  encodeResponse,
  parseMessage,
  createRequest,
  createResponse,
  createFragmentResponse,
  hashToKey,
  verifyHash,
  generatePeerHTLConfig,
  decrementHTL,
  shouldForward,
  type PeerHTLConfig,
  type PendingRequest,
} from '../webrtc/protocol.js';
import { LRUCache } from '../webrtc/lruCache.js';

// ============================================================================
// Types
// ============================================================================

interface WorkerPeer {
  peerId: string;
  pubkey: string;
  pool: PeerPool;
  direction: 'inbound' | 'outbound';
  state: 'connecting' | 'connected' | 'disconnected';
  dataChannelReady: boolean;
  answerCreated: boolean;  // Track if we've already created an answer (inbound only)
  htlConfig: PeerHTLConfig;
  pendingRequests: Map<string, PendingRequest>;
  theirRequests: LRUCache<string, { hash: Uint8Array; requestedAt: number }>;
  stats: PeerStats;
  createdAt: number;
  connectedAt?: number;
}

interface PeerStats {
  requestsSent: number;
  requestsReceived: number;
  responsesSent: number;
  responsesReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

export interface WebRTCControllerConfig {
  pubkey: string;
  localStore: Store;
  sendCommand: (cmd: WebRTCCommand) => void;
  sendSignaling: (msg: SignalingMessage, recipientPubkey?: string) => Promise<void>;
  getFollows?: () => Set<string>;
  requestTimeout?: number;
  debug?: boolean;
}

type PeerClassifier = (pubkey: string) => PeerPool;

// ============================================================================
// Controller
// ============================================================================

export class WebRTCController {
  private myPeerId: PeerId;
  private peers = new Map<string, WorkerPeer>();
  private localStore: Store;
  private sendCommand: (cmd: WebRTCCommand) => void;
  private sendSignaling: (msg: SignalingMessage, recipientPubkey?: string) => Promise<void>;
  private classifyPeer: PeerClassifier;
  private requestTimeout: number;
  private debug: boolean;

  // Pool configuration - defaults to 0 for others (safe default, production sets via settings)
  private poolConfig = {
    follows: { maxConnections: 10, satisfiedConnections: 3 },
    other: { maxConnections: 0, satisfiedConnections: 0 },
  };

  // Hello interval
  private helloInterval?: ReturnType<typeof setInterval>;
  private readonly HELLO_INTERVAL = 10000;

  constructor(config: WebRTCControllerConfig) {
    this.myPeerId = new PeerId(config.pubkey, generateUuid());
    this.localStore = config.localStore;
    this.sendCommand = config.sendCommand;
    this.sendSignaling = config.sendSignaling;
    this.requestTimeout = config.requestTimeout ?? 5000;
    this.debug = config.debug ?? false;

    // Default classifier: check if pubkey is in follows
    const getFollows = config.getFollows ?? (() => new Set<string>());
    this.classifyPeer = (pubkey: string) => {
      return getFollows().has(pubkey) ? 'follows' : 'other';
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(): void {
    this.log('Starting WebRTC controller');

    // Send hello periodically
    this.helloInterval = setInterval(() => {
      this.sendHello();
    }, this.HELLO_INTERVAL);

    // Send initial hello
    this.sendHello();
  }

  stop(): void {
    this.log('Stopping WebRTC controller');

    if (this.helloInterval) {
      clearInterval(this.helloInterval);
      this.helloInterval = undefined;
    }

    // Close all peers
    for (const peerId of this.peers.keys()) {
      this.closePeer(peerId);
    }
  }

  // ============================================================================
  // Signaling
  // ============================================================================

  private sendHello(): void {
    const msg: SignalingMessage = {
      type: 'hello',
      peerId: this.myPeerId.uuid,
    };
    console.log('[WebRTC] Calling sendSignaling for hello, myPeerId:', this.myPeerId.uuid.slice(0, 8));
    this.sendSignaling(msg).catch(err => {
      console.error('[WebRTC] sendSignaling error:', err);
    });
    this.log('Sent hello');
  }

  /**
   * Public method to trigger a hello broadcast.
   * Used for testing to force peer discovery after follows are set up.
   */
  broadcastHello(): void {
    this.sendHello();
  }

  /**
   * Handle incoming signaling message (from Nostr kind 25050)
   */
  async handleSignalingMessage(msg: SignalingMessage, senderPubkey: string): Promise<void> {
    // Skip messages from ourselves (same session)
    const senderPeerId = `${senderPubkey}:${msg.peerId}`;
    if (senderPeerId === this.myPeerId.toString()) {
      return;
    }

    this.log(`Signaling from ${senderPubkey.slice(0, 8)}:`, msg.type);

    switch (msg.type) {
      case 'hello':
        await this.handleHello(senderPubkey, msg.peerId);
        break;

      case 'offer':
        if (this.isMessageForUs(msg)) {
          await this.handleOffer(senderPeerId, senderPubkey, msg.offer!);
        }
        break;

      case 'answer':
        if (this.isMessageForUs(msg)) {
          await this.handleAnswer(senderPeerId, msg.answer!);
        }
        break;

      case 'candidate':
        if (this.isMessageForUs(msg)) {
          await this.handleIceCandidate(senderPeerId, msg.candidate!);
        }
        break;

      case 'candidates':
        if (this.isMessageForUs(msg)) {
          for (const candidate of msg.candidates!) {
            await this.handleIceCandidate(senderPeerId, candidate);
          }
        }
        break;
    }
  }

  private isMessageForUs(msg: SignalingMessage): boolean {
    if ('recipient' in msg && msg.recipient) {
      return msg.recipient === this.myPeerId.toString();
    }
    return true;
  }

  private async handleHello(senderPubkey: string, senderUuid: string): Promise<void> {
    const peerId = `${senderPubkey}:${senderUuid}`;

    // Already connected?
    if (this.peers.has(peerId)) {
      return;
    }

    // Check pool limits
    const pool = this.classifyPeer(senderPubkey);
    const follows = this.classifyPeer.toString().includes('getFollows') ? 'uses getFollows' : 'inline';
    console.log(`[WebRTC] handleHello from ${senderPubkey.slice(0, 8)}: pool=${pool}, poolConfig=`, this.poolConfig, `followsSize=${follows}`);
    if (!this.shouldConnect(pool)) {
      this.log(`Pool ${pool} at capacity, ignoring hello`);
      return;
    }

    // In 'other' pool, only allow 1 connection per pubkey
    if (pool === 'other' && this.hasOtherPoolPubkey(senderPubkey)) {
      this.log(`Already have connection from ${senderPubkey.slice(0, 8)} in other pool`);
      return;
    }

    // Tie-breaking: lower UUID initiates
    const shouldInitiate = this.myPeerId.uuid < senderUuid;
    if (shouldInitiate) {
      this.log(`Initiating connection to ${peerId.slice(0, 20)}`);
      await this.createOutboundPeer(peerId, senderPubkey, pool);
    } else {
      this.log(`Waiting for offer from ${peerId.slice(0, 20)}`);
    }
  }

  private async handleOffer(peerId: string, pubkey: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // Create peer if needed
    let peer = this.peers.get(peerId);
    if (!peer) {
      const pool = this.classifyPeer(pubkey);
      if (!this.shouldConnect(pool)) {
        this.log(`Pool ${pool} at capacity, rejecting offer`);
        return;
      }
      // In 'other' pool, only allow 1 connection per pubkey
      if (pool === 'other' && this.hasOtherPoolPubkey(pubkey)) {
        this.log(`Already have connection from ${pubkey.slice(0, 8)} in other pool, rejecting offer`);
        return;
      }
      peer = this.createPeer(peerId, pubkey, pool, 'inbound');
    }

    // Set remote description and create answer
    this.sendCommand({ type: 'rtc:setRemoteDescription', peerId, sdp: offer });
  }

  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      this.log(`Answer for unknown peer: ${peerId}`);
      return;
    }

    this.sendCommand({ type: 'rtc:setRemoteDescription', peerId, sdp: answer });
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }

    this.sendCommand({ type: 'rtc:addIceCandidate', peerId, candidate });
  }

  // ============================================================================
  // Peer Management
  // ============================================================================

  private shouldConnect(pool: PeerPool): boolean {
    const config = this.poolConfig[pool];
    const count = this.getPoolCount(pool);
    return count < config.maxConnections;
  }

  private getPoolCount(pool: PeerPool): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.pool === pool && peer.state !== 'disconnected') {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if we already have a connection from this pubkey in the 'other' pool.
   * In the 'other' pool, we only allow 1 connection per pubkey to prevent spam.
   */
  private hasOtherPoolPubkey(pubkey: string): boolean {
    for (const peer of this.peers.values()) {
      if (peer.pool === 'other' && peer.pubkey === pubkey && peer.state !== 'disconnected') {
        return true;
      }
    }
    return false;
  }

  private createPeer(peerId: string, pubkey: string, pool: PeerPool, direction: 'inbound' | 'outbound'): WorkerPeer {
    const peer: WorkerPeer = {
      peerId,
      pubkey,
      pool,
      direction,
      state: 'connecting',
      dataChannelReady: false,
      answerCreated: false,
      htlConfig: generatePeerHTLConfig(),
      pendingRequests: new Map(),
      theirRequests: new LRUCache(200),
      stats: {
        requestsSent: 0,
        requestsReceived: 0,
        responsesSent: 0,
        responsesReceived: 0,
        bytesSent: 0,
        bytesReceived: 0,
      },
      createdAt: Date.now(),
    };

    this.peers.set(peerId, peer);
    this.sendCommand({ type: 'rtc:createPeer', peerId, pubkey });

    return peer;
  }

  private async createOutboundPeer(peerId: string, pubkey: string, pool: PeerPool): Promise<void> {
    this.createPeer(peerId, pubkey, pool, 'outbound');
    // Proxy will create peer and we'll get rtc:peerCreated, then request offer
  }

  private closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Clear pending requests
    for (const pending of peer.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }

    peer.state = 'disconnected';
    this.sendCommand({ type: 'rtc:closePeer', peerId });
    this.peers.delete(peerId);

    this.log(`Closed peer: ${peerId.slice(0, 20)}`);
  }

  // ============================================================================
  // Proxy Events
  // ============================================================================

  /**
   * Handle event from main thread proxy
   */
  handleProxyEvent(event: WebRTCEvent): void {
    switch (event.type) {
      case 'rtc:peerCreated':
        this.onPeerCreated(event.peerId);
        break;

      case 'rtc:peerStateChange':
        this.onPeerStateChange(event.peerId, event.state);
        break;

      case 'rtc:peerClosed':
        this.onPeerClosed(event.peerId);
        break;

      case 'rtc:offerCreated':
        this.onOfferCreated(event.peerId, event.sdp);
        break;

      case 'rtc:answerCreated':
        this.onAnswerCreated(event.peerId, event.sdp);
        break;

      case 'rtc:descriptionSet':
        this.onDescriptionSet(event.peerId, event.error);
        break;

      case 'rtc:iceCandidate':
        this.onIceCandidate(event.peerId, event.candidate);
        break;

      case 'rtc:dataChannelOpen':
        this.onDataChannelOpen(event.peerId);
        break;

      case 'rtc:dataChannelMessage':
        this.onDataChannelMessage(event.peerId, event.data);
        break;

      case 'rtc:dataChannelClose':
        this.onDataChannelClose(event.peerId);
        break;

      case 'rtc:dataChannelError':
        this.onDataChannelError(event.peerId, event.error);
        break;
    }
  }

  private onPeerCreated(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // If outbound, create offer
    if (peer.direction === 'outbound') {
      this.sendCommand({ type: 'rtc:createOffer', peerId });
    }
  }

  private onPeerStateChange(peerId: string, state: RTCPeerConnectionState): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    this.log(`Peer ${peerId.slice(0, 20)} state: ${state}`);

    if (state === 'connected') {
      peer.state = 'connected';
      peer.connectedAt = Date.now();
    } else if (state === 'failed' || state === 'closed') {
      this.closePeer(peerId);
    }
  }

  private onPeerClosed(peerId: string): void {
    this.peers.delete(peerId);
  }

  private onOfferCreated(peerId: string, sdp: RTCSessionDescriptionInit): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Set local description
    this.sendCommand({ type: 'rtc:setLocalDescription', peerId, sdp });

    // Send offer via signaling
    const msg: SignalingMessage = {
      type: 'offer',
      offer: sdp,
      recipient: peerId,
      peerId: this.myPeerId.uuid,
    };
    this.sendSignaling(msg, peer.pubkey);
  }

  private onAnswerCreated(peerId: string, sdp: RTCSessionDescriptionInit): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Set local description
    this.sendCommand({ type: 'rtc:setLocalDescription', peerId, sdp });

    // Send answer via signaling
    const msg: SignalingMessage = {
      type: 'answer',
      answer: sdp,
      recipient: peerId,
      peerId: this.myPeerId.uuid,
    };
    this.sendSignaling(msg, peer.pubkey);
  }

  private onDescriptionSet(peerId: string, error?: string): void {
    if (error) {
      this.log(`Description set error for ${peerId}: ${error}`);
      return;
    }

    const peer = this.peers.get(peerId);
    if (!peer) return;

    // If we just set remote description for inbound, create answer (only once)
    if (peer.direction === 'inbound' && peer.state === 'connecting' && !peer.answerCreated) {
      peer.answerCreated = true;
      this.sendCommand({ type: 'rtc:createAnswer', peerId });
    }
  }

  private onIceCandidate(peerId: string, candidate: RTCIceCandidateInit | null): void {
    if (!candidate) return;

    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Send candidate via signaling
    const msg: SignalingMessage = {
      type: 'candidate',
      candidate,
      recipient: peerId,
      peerId: this.myPeerId.uuid,
    };
    this.sendSignaling(msg, peer.pubkey);
  }

  private onDataChannelOpen(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.dataChannelReady = true;
    this.log(`Data channel open: ${peerId.slice(0, 20)}`);
  }

  private onDataChannelClose(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.dataChannelReady = false;
    this.closePeer(peerId);
  }

  private onDataChannelError(peerId: string, error: string): void {
    this.log(`Data channel error for ${peerId}: ${error}`);
  }

  // ============================================================================
  // Data Protocol
  // ============================================================================

  private async onDataChannelMessage(peerId: string, data: Uint8Array): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const msg = parseMessage(data);
    if (!msg) {
      this.log(`Failed to parse message from ${peerId}`);
      return;
    }

    if (msg.type === MSG_TYPE_REQUEST) {
      await this.handleRequest(peer, msg.body);
    } else if (msg.type === MSG_TYPE_RESPONSE) {
      await this.handleResponse(peer, msg.body);
    }
  }

  private async handleRequest(peer: WorkerPeer, req: DataRequest): Promise<void> {
    peer.stats.requestsReceived++;
    const hashKey = hashToKey(req.h);

    // Try to get from local store
    const data = await this.localStore.get(req.h);

    if (data) {
      // Send response
      await this.sendResponse(peer, req.h, data);
    } else {
      // Track their request for later push
      peer.theirRequests.set(hashKey, {
        hash: req.h,
        requestedAt: Date.now(),
      });

      // Forward if HTL allows
      const htl = req.htl ?? MAX_HTL;
      if (shouldForward(htl)) {
        const newHtl = decrementHTL(htl, peer.htlConfig);
        await this.forwardRequest(req.h, peer.peerId, newHtl);
      }
    }
  }

  private async handleResponse(peer: WorkerPeer, res: DataResponse): Promise<void> {
    peer.stats.responsesReceived++;
    peer.stats.bytesReceived += res.d.length;

    const hashKey = hashToKey(res.h);
    const pending = peer.pendingRequests.get(hashKey);

    if (!pending) {
      // Unsolicited response - might be push from their request tracking
      return;
    }

    clearTimeout(pending.timeout);
    peer.pendingRequests.delete(hashKey);

    // Verify hash
    const valid = await verifyHash(res.d, res.h);
    if (valid) {
      // Store locally
      await this.localStore.put(res.h, res.d);
      pending.resolve(res.d);

      // Push to peers who requested this
      await this.pushToRequesters(res.h, res.d, peer.peerId);
    } else {
      this.log(`Hash mismatch from ${peer.peerId}`);
      pending.resolve(null);
    }
  }

  private async sendResponse(peer: WorkerPeer, hash: Uint8Array, data: Uint8Array): Promise<void> {
    if (!peer.dataChannelReady) return;

    peer.stats.responsesSent++;
    peer.stats.bytesSent += data.length;

    // Fragment if needed
    if (data.length > FRAGMENT_SIZE) {
      const totalFragments = Math.ceil(data.length / FRAGMENT_SIZE);
      for (let i = 0; i < totalFragments; i++) {
        const start = i * FRAGMENT_SIZE;
        const end = Math.min(start + FRAGMENT_SIZE, data.length);
        const fragment = data.slice(start, end);
        const res = createFragmentResponse(hash, fragment, i, totalFragments);
        const encoded = new Uint8Array(encodeResponse(res));
        this.sendCommand({ type: 'rtc:sendData', peerId: peer.peerId, data: encoded });
      }
    } else {
      const res = createResponse(hash, data);
      const encoded = new Uint8Array(encodeResponse(res));
      this.sendCommand({ type: 'rtc:sendData', peerId: peer.peerId, data: encoded });
    }
  }

  private async forwardRequest(hash: Uint8Array, excludePeerId: string, htl: number): Promise<void> {
    const hashKey = hashToKey(hash);

    // Forward to all connected peers except the one who sent it
    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      if (!peer.dataChannelReady) continue;

      // Set up pending request so we can process the response
      const timeout = setTimeout(() => {
        peer.pendingRequests.delete(hashKey);
      }, this.requestTimeout);

      peer.pendingRequests.set(hashKey, {
        hash,
        resolve: () => {
          // Response will be pushed to original requester via pushToRequesters
        },
        timeout,
      });

      const req = createRequest(hash, htl);
      const encoded = new Uint8Array(encodeRequest(req));
      this.sendCommand({ type: 'rtc:sendData', peerId, data: encoded });
    }
  }

  private async pushToRequesters(hash: Uint8Array, data: Uint8Array, excludePeerId: string): Promise<void> {
    const hashKey = hashToKey(hash);

    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;

      const theirReq = peer.theirRequests.get(hashKey);
      if (theirReq) {
        peer.theirRequests.delete(hashKey);
        await this.sendResponse(peer, hash, data);
      }
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Request data from peers
   */
  async get(hash: Uint8Array): Promise<Uint8Array | null> {
    // Try connected peers
    const connectedPeers = Array.from(this.peers.values())
      .filter(p => p.dataChannelReady);

    if (connectedPeers.length === 0) {
      return null;
    }

    // Send request to all peers, first response wins
    return new Promise((resolve) => {
      let resolved = false;
      const hashKey = hashToKey(hash);

      for (const peer of connectedPeers) {
        const timeout = setTimeout(() => {
          peer.pendingRequests.delete(hashKey);
          checkDone();
        }, this.requestTimeout);

        peer.pendingRequests.set(hashKey, {
          hash,
          resolve: (data) => {
            if (!resolved && data) {
              resolved = true;
              resolve(data);
            }
            checkDone();
          },
          timeout,
        });

        peer.stats.requestsSent++;
        const req = createRequest(hash, MAX_HTL);
        const encoded = new Uint8Array(encodeRequest(req));
        this.sendCommand({ type: 'rtc:sendData', peerId: peer.peerId, data: encoded });
      }

      let pending = connectedPeers.length;
      const checkDone = () => {
        pending--;
        if (pending === 0 && !resolved) {
          resolve(null);
        }
      };
    });
  }

  /**
   * Get peer stats for UI
   */
  getPeerStats(): Array<{
    peerId: string;
    pubkey: string;
    connected: boolean;
    pool: PeerPool;
    requestsSent: number;
    requestsReceived: number;
    responsesSent: number;
    responsesReceived: number;
    bytesSent: number;
    bytesReceived: number;
  }> {
    return Array.from(this.peers.values()).map(peer => ({
      peerId: peer.peerId,
      pubkey: peer.pubkey,
      connected: peer.state === 'connected' && peer.dataChannelReady,
      pool: peer.pool,
      requestsSent: peer.stats.requestsSent,
      requestsReceived: peer.stats.requestsReceived,
      responsesSent: peer.stats.responsesSent,
      responsesReceived: peer.stats.responsesReceived,
      bytesSent: peer.stats.bytesSent,
      bytesReceived: peer.stats.bytesReceived,
    }));
  }

  /**
   * Get connected peer count
   */
  getConnectedCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.state === 'connected' && peer.dataChannelReady) {
        count++;
      }
    }
    return count;
  }

  /**
   * Set pool configuration
   */
  setPoolConfig(config: { follows: { max: number; satisfied: number }; other: { max: number; satisfied: number } }): void {
    this.poolConfig = {
      follows: { maxConnections: config.follows.max, satisfiedConnections: config.follows.satisfied },
      other: { maxConnections: config.other.max, satisfiedConnections: config.other.satisfied },
    };
    this.log('Pool config updated:', this.poolConfig);

    // Re-broadcast hello to trigger peer discovery with new limits
    this.sendHello();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[WebRTC]', ...args);
    }
  }
}
