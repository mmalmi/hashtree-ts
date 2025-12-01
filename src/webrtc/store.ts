/**
 * WebRTC-based distributed store for hashtree
 *
 * Implements the Store interface, fetching data from P2P network.
 * Uses Nostr relays for WebRTC signaling.
 *
 * Security: Directed signaling messages (offer, answer, candidate, candidates)
 * are encrypted with NIP-04 for privacy. Hello messages remain unencrypted
 * for peer discovery.
 */
import { SimplePool, type Event } from 'nostr-tools';
import type { Store, Hash } from '../types.js';
import {
  PeerId,
  generateUuid,
  type SignalingMessage,
  type DirectedMessage,
  type WebRTCStoreConfig,
  type PeerStatus,
  type WebRTCStoreEvent,
  type WebRTCStoreEventHandler,
  type EventSigner,
  type EventEncrypter,
  type EventDecrypter,
} from './types.js';
import { Peer } from './peer.js';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const WEBRTC_KIND = 30078; // KIND_APP_DATA - same as iris-client
const WEBRTC_TAG = 'webrtc';

export class WebRTCStore implements Store {
  private config: {
    satisfiedConnections: number;
    maxConnections: number;
    helloInterval: number;
    messageTimeout: number;
    requestTimeout: number;
    relays: string[];
    localStore: Store | null;
    debug: boolean;
  };
  private signer: EventSigner;
  private encrypt: EventEncrypter;
  private decrypt: EventDecrypter;
  private myPeerId: PeerId;
  private pool: SimplePool;
  private subscription: ReturnType<SimplePool['subscribe']> | null = null;
  private peers = new Map<string, Peer>();
  private helloInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers = new Set<WebRTCStoreEventHandler>();
  private running = false;

  constructor(config: WebRTCStoreConfig) {
    this.signer = config.signer;
    this.encrypt = config.encrypt;
    this.decrypt = config.decrypt;
    this.myPeerId = new PeerId(config.pubkey, generateUuid());

    this.config = {
      satisfiedConnections: config.satisfiedConnections ?? 3,
      maxConnections: config.maxConnections ?? 6,
      helloInterval: config.helloInterval ?? 10000,
      messageTimeout: config.messageTimeout ?? 15000,
      requestTimeout: config.requestTimeout ?? 5000,
      relays: config.relays ?? DEFAULT_RELAYS,
      localStore: config.localStore ?? null,
      debug: config.debug ?? false,
    };

    this.pool = new SimplePool();
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[WebRTCStore]', ...args);
    }
  }

  /**
   * Start the WebRTC store - connect to relays and begin peer discovery
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.log('Starting with peerId:', this.myPeerId.short());

    // Subscribe to signaling messages
    this.startSubscription();

    // Send hello messages when not satisfied
    this.helloInterval = setInterval(() => {
      this.maybeSendHello();
    }, this.config.helloInterval);

    // Send initial hello
    this.maybeSendHello();

    // Cleanup stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupConnections();
    }, 5000);
  }

  /**
   * Stop the WebRTC store
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.log('Stopping');

    if (this.helloInterval) {
      clearInterval(this.helloInterval);
      this.helloInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    // Close all peer connections
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
  }

  /**
   * Add event listener
   */
  on(handler: WebRTCStoreEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: WebRTCStoreEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private startSubscription(): void {
    const since = Math.floor((Date.now() - this.config.messageTimeout) / 1000);

    this.subscription = this.pool.subscribe(
      this.config.relays,
      {
        kinds: [WEBRTC_KIND],
        '#l': [WEBRTC_TAG],
        since,
      },
      {
        onevent: (event: Event) => {
          this.handleSignalingEvent(event);
        },
        oneose: () => {
          this.log('Subscription EOSE received');
        },
      }
    );
  }

  private async handleSignalingEvent(event: Event): Promise<void> {
    // Filter out old events (created more than messageTimeout ago)
    const eventAge = Date.now() / 1000 - (event.created_at ?? 0);
    if (eventAge > this.config.messageTimeout / 1000) {
      return;
    }

    // Check expiration
    const expirationTag = event.tags.find(t => t[0] === 'expiration');
    if (expirationTag) {
      const expiration = parseInt(expirationTag[1], 10);
      if (expiration < Date.now() / 1000) {
        return;
      }
    }

    // Check if this is a hello message (d-tag = "hello", peerId in tag)
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag === 'hello') {
      const peerIdTag = event.tags.find(t => t[0] === 'peerId')?.[1];
      if (peerIdTag) {
        await this.handleHello(peerIdTag, event.pubkey);
      }
      return;
    }

    // Directed message - must be encrypted
    if (!event.content) {
      return;
    }

    try {
      const content = await this.decrypt(event.pubkey, event.content);
      const msg = JSON.parse(content) as DirectedMessage;
      await this.handleSignalingMessage(msg, event.pubkey);
    } catch {
      // Not for us or invalid - ignore silently
    }
  }

  private async handleSignalingMessage(msg: DirectedMessage, senderPubkey: string): Promise<void> {
    // Directed message - check if it's for us
    if (msg.recipient !== this.myPeerId.toString()) {
      return;
    }

    const peerId = new PeerId(senderPubkey, msg.peerId);
    const peerIdStr = peerId.toString();

    if (msg.type === 'offer') {
      await this.handleOffer(peerId, msg);
    } else {
      // answer or candidate
      const peer = this.peers.get(peerIdStr);
      if (peer) {
        await peer.handleSignaling(msg, this.myPeerId.uuid);
      }
    }
  }

  private async handleHello(peerUuid: string, senderPubkey: string): Promise<void> {
    const peerId = new PeerId(senderPubkey, peerUuid);

    // Skip self (exact same peerId = same session)
    if (peerId.toString() === this.myPeerId.toString()) {
      return;
    }

    // Check if we should connect
    if (this.peers.has(peerId.toString())) {
      return; // Already have this peer
    }

    // Limit total peers (including pending), not just connected
    if (this.peers.size >= this.config.maxConnections) {
      return; // At max peers
    }

    this.log('Received hello from', peerId.short());

    // Tie-breaking: lower UUID initiates
    if (this.myPeerId.uuid < peerUuid) {
      await this.connectToPeer(peerId);
    }
  }

  private async handleOffer(peerId: PeerId, msg: SignalingMessage): Promise<void> {
    // Skip self (exact same peerId)
    if (peerId.toString() === this.myPeerId.toString()) {
      return;
    }

    const peerIdStr = peerId.toString();

    // Limit total peers
    if (this.peers.size >= this.config.maxConnections && !this.peers.has(peerIdStr)) {
      this.log('Rejecting offer - at max peers');
      return;
    }

    // Clean up existing connection if any
    const existing = this.peers.get(peerIdStr);
    if (existing) {
      existing.close();
      this.peers.delete(peerIdStr);
    }

    this.log('Accepting offer from', peerId.short());

    const peer = new Peer({
      peerId,
      direction: 'inbound',
      localStore: this.config.localStore,
      sendSignaling: (m) => this.sendSignaling(m, peerId.pubkey),
      onClose: () => this.handlePeerClose(peerIdStr),
      onConnected: () => {
        this.emit({ type: 'peer-connected', peerId: peerIdStr });
        this.emit({ type: 'update' });
      },
      requestTimeout: this.config.requestTimeout,
      debug: this.config.debug,
    });

    this.peers.set(peerIdStr, peer);
    await peer.handleSignaling(msg, this.myPeerId.uuid);
  }

  private async connectToPeer(peerId: PeerId): Promise<void> {
    const peerIdStr = peerId.toString();

    if (this.peers.has(peerIdStr)) {
      return;
    }

    this.log('Initiating connection to', peerId.short());

    const peer = new Peer({
      peerId,
      direction: 'outbound',
      localStore: this.config.localStore,
      sendSignaling: (m) => this.sendSignaling(m, peerId.pubkey),
      onClose: () => this.handlePeerClose(peerIdStr),
      onConnected: () => {
        this.emit({ type: 'peer-connected', peerId: peerIdStr });
        this.emit({ type: 'update' });
      },
      requestTimeout: this.config.requestTimeout,
      debug: this.config.debug,
    });

    this.peers.set(peerIdStr, peer);
    await peer.connect(this.myPeerId.uuid);
  }

  private handlePeerClose(peerIdStr: string): void {
    this.peers.delete(peerIdStr);
    this.emit({ type: 'peer-disconnected', peerId: peerIdStr });
    this.emit({ type: 'update' });
  }

  private async sendSignaling(msg: SignalingMessage, recipientPubkey?: string): Promise<void> {
    // Fill in our peer ID
    if ('peerId' in msg && msg.peerId === '') {
      msg.peerId = this.myPeerId.uuid;
    }

    // Encrypt if we have a recipient (offer, answer, candidate, candidates)
    // Hello messages use tags only, no content needed
    let content: string;
    let tags: string[][];
    let expiration: number;

    if (recipientPubkey) {
      const plaintext = JSON.stringify(msg);
      content = await this.encrypt(recipientPubkey, plaintext);
      tags = [
        ['l', WEBRTC_TAG],
        ['d', generateUuid()], // Unique d-tag for directed messages
      ];
      expiration = Math.floor((Date.now() + this.config.messageTimeout) / 1000);
    } else {
      // Hello message - peerId in tag, no content needed
      content = '';
      tags = [
        ['l', WEBRTC_TAG],
        ['d', 'hello'], // Static d-tag for hello - each new hello replaces previous (NIP-33)
        ['peerId', msg.peerId],
      ];
      expiration = Math.floor((Date.now() + 5 * 60 * 1000) / 1000); // 5 minutes for hello
    }

    tags.push(['expiration', expiration.toString()]);

    const eventTemplate = {
      kind: WEBRTC_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    };

    const event = await this.signer(eventTemplate) as Event;
    await this.pool.publish(this.config.relays, event);
  }

  private maybeSendHello(): void {
    if (!this.running) return;

    const connectedCount = this.getConnectedCount();
    if (connectedCount >= this.config.satisfiedConnections) {
      this.log('Satisfied with', connectedCount, 'connections, not sending hello');
      return;
    }

    this.log('Sending hello (have', connectedCount, 'connections)');
    this.sendSignaling({
      type: 'hello',
      peerId: this.myPeerId.uuid,
    });
  }

  private cleanupConnections(): void {
    const now = Date.now();
    const connectionTimeout = 15000; // 15 seconds to establish connection

    for (const [peerIdStr, peer] of this.peers) {
      const state = peer.state;
      const isStale = state === 'new' && (now - peer.createdAt) > connectionTimeout;

      if (state === 'failed' || state === 'closed' || state === 'disconnected' || isStale) {
        this.log('Cleaning up', state, 'connection', isStale ? '(stale)' : '');
        peer.close();
        this.peers.delete(peerIdStr);
        this.emit({ type: 'update' });
      }
    }
  }

  /**
   * Get number of connected peers
   */
  getConnectedCount(): number {
    return Array.from(this.peers.values())
      .filter(p => p.isConnected).length;
  }

  /**
   * Get all peer statuses
   */
  getPeers(): PeerStatus[] {
    return Array.from(this.peers.values()).map(p => ({
      peerId: p.peerId,
      pubkey: p.pubkey,
      state: p.state,
      direction: p.direction,
      connectedAt: p.connectedAt,
      isSelf: p.pubkey === this.myPeerId.pubkey,
    }));
  }

  /**
   * Get my peer ID (uuid part only)
   */
  getMyPeerId(): string {
    return this.myPeerId.uuid;
  }

  /**
   * Check if store is satisfied (has enough connections)
   */
  isSatisfied(): boolean {
    return this.getConnectedCount() >= this.config.satisfiedConnections;
  }

  // Store interface implementation

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    // WebRTC store is read-only from network
    // Write to local store if available
    if (this.config.localStore) {
      return this.config.localStore.put(hash, data);
    }
    return false;
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    // Try local store first
    if (this.config.localStore) {
      const local = await this.config.localStore.get(hash);
      if (local) return local;
    }

    // Try each connected peer
    const connectedPeers = Array.from(this.peers.values())
      .filter(p => p.isConnected);

    for (const peer of connectedPeers) {
      const data = await peer.request(hash);
      if (data) {
        // Store locally for future requests
        if (this.config.localStore) {
          await this.config.localStore.put(hash, data);
        }
        return data;
      }
    }

    return null;
  }

  async has(hash: Hash): Promise<boolean> {
    // Check local store
    if (this.config.localStore) {
      const hasLocal = await this.config.localStore.has(hash);
      if (hasLocal) return true;
    }

    // Could query peers, but for now just check locally
    return false;
  }

  async delete(hash: Hash): Promise<boolean> {
    // Only delete from local store
    if (this.config.localStore) {
      return this.config.localStore.delete(hash);
    }
    return false;
  }
}
