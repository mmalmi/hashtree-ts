/**
 * WebRTC Manager for Worker
 *
 * Manages P2P connections for hashtree data transfer.
 * Uses ephemeral keys for signaling (not user's real identity).
 *
 * Signaling protocol (kind 25050):
 * - Hello messages: broadcast for peer discovery
 * - Directed messages (offer/answer/candidates): to specific peers
 */

import type { Store, Hash } from '../types';
import { toHex } from '../types';
import { encode, decode } from '@msgpack/msgpack';
import { getNostrManager } from './nostr';
import { signWithEphemeralKey, getEphemeralPubkey } from './worker';
import type { SignedEvent } from './protocol';

// Signaling message types
interface HelloMessage {
  type: 'hello';
  peerId: string;
}

interface OfferMessage {
  type: 'offer';
  offer: RTCSessionDescriptionInit;
  peerId: string;
}

interface AnswerMessage {
  type: 'answer';
  answer: RTCSessionDescriptionInit;
  peerId: string;
}

interface CandidatesMessage {
  type: 'candidates';
  candidates: RTCIceCandidateInit[];
  peerId: string;
}

type SignalingMessage = HelloMessage | OfferMessage | AnswerMessage | CandidatesMessage;

// Data channel message types
const MSG_TYPE_REQUEST = 0x00;
const MSG_TYPE_RESPONSE = 0x01;

interface DataRequest {
  h: Uint8Array;  // hash
  htl?: number;   // hops to live
}

interface DataResponse {
  h: Uint8Array;  // hash
  d: Uint8Array;  // data
  i?: number;     // fragment index
  n?: number;     // total fragments
}

// Peer connection state
interface PeerInfo {
  pubkey: string;
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connected: boolean;
  requestsSent: number;
  requestsReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

// Constants
const SIGNALING_KIND = 25050;
const HELLO_TAG = 'hello';
const MAX_PEERS = 6;
const HELLO_INTERVAL = 10000;
const FRAGMENT_SIZE = 32 * 1024;

export class WebRTCManager {
  private peers = new Map<string, PeerInfo>();
  private store: Store | null = null;
  private running = false;
  private helloInterval: ReturnType<typeof setInterval> | null = null;
  private myPeerId: string;
  private pendingRequests = new Map<string, {
    resolve: (data: Uint8Array | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor() {
    // Generate unique peer ID (ephemeral pubkey + random UUID)
    this.myPeerId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Initialize with a store for serving data
   */
  init(store: Store): void {
    this.store = store;
  }

  /**
   * Start peer discovery and signaling
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    const pubkey = getEphemeralPubkey();
    if (!pubkey) {
      console.error('[WebRTCManager] No ephemeral pubkey available');
      return;
    }

    console.log('[WebRTCManager] Starting with peerId:', this.myPeerId.slice(0, 8) + '...');

    // Subscribe to signaling messages directed at us
    const nostr = getNostrManager();
    nostr.subscribe('webrtc-signaling', [{
      kinds: [SIGNALING_KIND],
      '#p': [pubkey],
    }]);

    // Subscribe to hello broadcasts
    nostr.subscribe('webrtc-hello', [{
      kinds: [SIGNALING_KIND],
      '#l': [HELLO_TAG],
      since: Math.floor(Date.now() / 1000) - 60, // Last 60 seconds
    }]);

    // Start sending hello messages
    this.sendHello();
    this.helloInterval = setInterval(() => this.sendHello(), HELLO_INTERVAL);
  }

  /**
   * Stop all connections
   */
  stop(): void {
    this.running = false;

    if (this.helloInterval) {
      clearInterval(this.helloInterval);
      this.helloInterval = null;
    }

    // Close all peer connections
    for (const [, peer] of this.peers) {
      peer.connection.close();
    }
    this.peers.clear();

    // Unsubscribe from Nostr
    const nostr = getNostrManager();
    nostr.unsubscribe('webrtc-signaling');
    nostr.unsubscribe('webrtc-hello');

    console.log('[WebRTCManager] Stopped');
  }

  /**
   * Handle incoming Nostr event (called by worker message handler)
   */
  handleNostrEvent(event: SignedEvent): void {
    try {
      const msg = JSON.parse(event.content) as SignalingMessage;

      // Ignore our own messages
      if (msg.peerId === this.myPeerId) return;

      switch (msg.type) {
        case 'hello':
          this.handleHello(event.pubkey, msg);
          break;
        case 'offer':
          this.handleOffer(event.pubkey, msg);
          break;
        case 'answer':
          this.handleAnswer(event.pubkey, msg);
          break;
        case 'candidates':
          this.handleCandidates(event.pubkey, msg);
          break;
      }
    } catch (err) {
      console.error('[WebRTCManager] Failed to handle event:', err);
    }
  }

  /**
   * Request data from peers
   */
  async get(hash: Hash): Promise<Uint8Array | null> {
    // Try connected peers
    for (const [, peer] of this.peers) {
      if (peer.connected && peer.dataChannel?.readyState === 'open') {
        const result = await this.requestFromPeer(peer, hash);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Get peer stats
   */
  getPeerStats(): Array<{
    peerId: string;
    pubkey: string;
    connected: boolean;
    requestsSent: number;
    requestsReceived: number;
    bytesSent: number;
    bytesReceived: number;
  }> {
    const stats = [];
    for (const [, peer] of this.peers) {
      stats.push({
        peerId: peer.peerId,
        pubkey: peer.pubkey,
        connected: peer.connected,
        requestsSent: peer.requestsSent,
        requestsReceived: peer.requestsReceived,
        bytesSent: peer.bytesSent,
        bytesReceived: peer.bytesReceived,
      });
    }
    return stats;
  }

  // ============================================================================
  // Private: Signaling
  // ============================================================================

  private sendHello(): void {
    if (!this.running) return;

    const msg: HelloMessage = {
      type: 'hello',
      peerId: this.myPeerId,
    };

    const event = signWithEphemeralKey({
      kind: SIGNALING_KIND,
      content: JSON.stringify(msg),
      tags: [['l', HELLO_TAG]],
      created_at: Math.floor(Date.now() / 1000),
    });

    const nostr = getNostrManager();
    nostr.publish(event).catch(err => {
      console.error('[WebRTCManager] Failed to send hello:', err);
    });
  }

  private async sendSignalingMessage(recipientPubkey: string, msg: SignalingMessage): Promise<void> {
    const event = signWithEphemeralKey({
      kind: SIGNALING_KIND,
      content: JSON.stringify(msg),
      tags: [['p', recipientPubkey]],
      created_at: Math.floor(Date.now() / 1000),
    });

    const nostr = getNostrManager();
    await nostr.publish(event);
  }

  private handleHello(senderPubkey: string, msg: HelloMessage): void {
    // Don't connect to ourselves
    if (msg.peerId === this.myPeerId) return;

    // Check if we already have this peer
    if (this.peers.has(msg.peerId)) return;

    // Check if we have room for more peers
    if (this.peers.size >= MAX_PEERS) return;

    console.log('[WebRTCManager] Got hello from:', msg.peerId.slice(0, 8) + '...');

    // Initiate connection (we're the offerer)
    this.createPeerConnection(senderPubkey, msg.peerId, true);
  }

  private handleOffer(senderPubkey: string, msg: OfferMessage): void {
    console.log('[WebRTCManager] Got offer from:', msg.peerId.slice(0, 8) + '...');

    // Create peer connection if we don't have one
    let peer = this.peers.get(msg.peerId);
    if (!peer) {
      if (this.peers.size >= MAX_PEERS) return;
      peer = this.createPeerConnection(senderPubkey, msg.peerId, false);
    }

    // Set remote description and create answer
    peer.connection.setRemoteDescription(msg.offer)
      .then(() => peer!.connection.createAnswer())
      .then(answer => peer!.connection.setLocalDescription(answer))
      .then(() => {
        const answerMsg: AnswerMessage = {
          type: 'answer',
          answer: peer!.connection.localDescription!,
          peerId: this.myPeerId,
        };
        return this.sendSignalingMessage(senderPubkey, answerMsg);
      })
      .catch(err => console.error('[WebRTCManager] Failed to handle offer:', err));
  }

  private handleAnswer(senderPubkey: string, msg: AnswerMessage): void {
    const peer = this.peers.get(msg.peerId);
    if (!peer) return;

    console.log('[WebRTCManager] Got answer from:', msg.peerId.slice(0, 8) + '...');

    peer.connection.setRemoteDescription(msg.answer)
      .catch(err => console.error('[WebRTCManager] Failed to set answer:', err));
  }

  private handleCandidates(senderPubkey: string, msg: CandidatesMessage): void {
    const peer = this.peers.get(msg.peerId);
    if (!peer) return;

    for (const candidate of msg.candidates) {
      peer.connection.addIceCandidate(candidate)
        .catch(err => console.error('[WebRTCManager] Failed to add ICE candidate:', err));
    }
  }

  // ============================================================================
  // Private: Peer Connections
  // ============================================================================

  private createPeerConnection(pubkey: string, peerId: string, isOfferer: boolean): PeerInfo {
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    const peer: PeerInfo = {
      pubkey,
      peerId,
      connection,
      dataChannel: null,
      connected: false,
      requestsSent: 0,
      requestsReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };

    this.peers.set(peerId, peer);

    // Collect ICE candidates
    const candidates: RTCIceCandidateInit[] = [];
    let candidateTimeout: ReturnType<typeof setTimeout> | null = null;

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push(event.candidate.toJSON());

        // Batch send candidates after 500ms of no new candidates
        if (candidateTimeout) clearTimeout(candidateTimeout);
        candidateTimeout = setTimeout(() => {
          if (candidates.length > 0) {
            const msg: CandidatesMessage = {
              type: 'candidates',
              candidates: [...candidates],
              peerId: this.myPeerId,
            };
            this.sendSignalingMessage(pubkey, msg);
            candidates.length = 0;
          }
        }, 500);
      }
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      console.log('[WebRTCManager] Connection state:', peerId.slice(0, 8) + '...', state);

      if (state === 'connected') {
        peer.connected = true;
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        peer.connected = false;
        this.peers.delete(peerId);
      }
    };

    // Data channel handling
    if (isOfferer) {
      // Create data channel
      const channel = connection.createDataChannel('hashtree', {
        ordered: false,
        maxRetransmits: 3,
      });
      this.setupDataChannel(peer, channel);

      // Create and send offer
      connection.createOffer()
        .then(offer => connection.setLocalDescription(offer))
        .then(() => {
          const offerMsg: OfferMessage = {
            type: 'offer',
            offer: connection.localDescription!,
            peerId: this.myPeerId,
          };
          return this.sendSignalingMessage(pubkey, offerMsg);
        })
        .catch(err => console.error('[WebRTCManager] Failed to create offer:', err));
    } else {
      // Wait for data channel from offerer
      connection.ondatachannel = (event) => {
        this.setupDataChannel(peer, event.channel);
      };
    }

    return peer;
  }

  private setupDataChannel(peer: PeerInfo, channel: RTCDataChannel): void {
    peer.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('[WebRTCManager] Data channel open:', peer.peerId.slice(0, 8) + '...');
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(peer, new Uint8Array(event.data));
    };

    channel.onerror = (err) => {
      console.error('[WebRTCManager] Data channel error:', err);
    };
  }

  private handleDataChannelMessage(peer: PeerInfo, data: Uint8Array): void {
    if (data.length < 2) return;

    const type = data[0];
    const body = data.slice(1);

    try {
      if (type === MSG_TYPE_REQUEST) {
        // Handle incoming request
        const req = decode(body) as DataRequest;
        peer.requestsReceived++;
        this.handleDataRequest(peer, req);
      } else if (type === MSG_TYPE_RESPONSE) {
        // Handle incoming response
        const res = decode(body) as DataResponse;
        peer.bytesReceived += res.d.length;
        this.handleDataResponse(peer, res);
      }
    } catch (err) {
      console.error('[WebRTCManager] Failed to handle data message:', err);
    }
  }

  private async handleDataRequest(peer: PeerInfo, req: DataRequest): Promise<void> {
    if (!this.store) return;

    const data = await this.store.get(req.h);
    if (!data) return;

    // Send response (fragment if necessary)
    if (data.length <= FRAGMENT_SIZE) {
      // Single response
      const res: DataResponse = { h: req.h, d: data };
      const msg = new Uint8Array([MSG_TYPE_RESPONSE, ...encode(res)]);
      peer.dataChannel?.send(msg);
      peer.bytesSent += data.length;
    } else {
      // Fragmented response
      const totalFragments = Math.ceil(data.length / FRAGMENT_SIZE);
      for (let i = 0; i < totalFragments; i++) {
        const start = i * FRAGMENT_SIZE;
        const end = Math.min(start + FRAGMENT_SIZE, data.length);
        const fragment = data.slice(start, end);

        const res: DataResponse = {
          h: req.h,
          d: fragment,
          i: i,
          n: totalFragments,
        };
        const msg = new Uint8Array([MSG_TYPE_RESPONSE, ...encode(res)]);
        peer.dataChannel?.send(msg);
        peer.bytesSent += fragment.length;
      }
    }
  }

  private handleDataResponse(peer: PeerInfo, res: DataResponse): void {
    const hashHex = toHex(res.h);
    const pending = this.pendingRequests.get(hashHex);
    if (!pending) return;

    // TODO: Handle fragmented responses (reassembly)
    // For now, just handle single responses
    if (res.i === undefined) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(hashHex);
      pending.resolve(res.d);
    }
  }

  private requestFromPeer(peer: PeerInfo, hash: Hash): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const hashHex = toHex(hash);

      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(hashHex);
        resolve(null);
      }, 5000);

      this.pendingRequests.set(hashHex, { resolve, timeout });

      // Send request
      const req: DataRequest = { h: hash };
      const msg = new Uint8Array([MSG_TYPE_REQUEST, ...encode(req)]);
      peer.dataChannel?.send(msg);
      peer.requestsSent++;
    });
  }
}

// Singleton
let instance: WebRTCManager | null = null;

export function getWebRTCManager(): WebRTCManager {
  if (!instance) {
    instance = new WebRTCManager();
  }
  return instance;
}

export function closeWebRTCManager(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
