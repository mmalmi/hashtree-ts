/**
 * WebRTC-based distributed store for hashtree
 *
 * Implements the Store interface, fetching data from P2P network.
 * Uses Nostr relays for WebRTC signaling.
 *
 * Security: Directed signaling messages (offer, answer, candidate, candidates)
 * are encrypted with NIP-04 for privacy. Hello messages remain unencrypted
 * for peer discovery.
 *
 * Pool-based peer management:
 * - 'follows' pool: Users in your social graph (followed or followers)
 * - 'other' pool: Everyone else (randos)
 * Each pool has its own connection limits.
 */
import { SimplePool, type Event } from 'nostr-tools';
import type { Store, Hash } from '../types.js';
import { toHex } from '../types.js';
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
  type PeerPool,
  type PeerClassifier,
  type PoolConfig,
} from './types.js';
import { Peer } from './peer.js';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://temp.iris.to',
  'wss://relay.snort.social',
];

const WEBRTC_KIND = 30078; // KIND_APP_DATA - same as iris-client
const WEBRTC_TAG = 'webrtc';


// Pending request with callbacks
interface PendingReq {
  resolve: (data: Uint8Array | null) => void;
  timeout: ReturnType<typeof setTimeout>;
  triedPeers: Set<string>;
}

// Extended peer info with pool assignment
interface PeerInfo {
  peer: Peer;
  pool: PeerPool;
}

export class WebRTCStore implements Store {
  private config: {
    helloInterval: number;
    messageTimeout: number;
    requestTimeout: number;
    peerQueryDelay: number;
    relays: string[];
    localStore: Store | null;
    fallbackStores: Store[];
    debug: boolean;
  };
  private pools: { follows: PoolConfig; other: PoolConfig };
  private peerClassifier: PeerClassifier;
  private signer: EventSigner;
  private encrypt: EventEncrypter;
  private decrypt: EventDecrypter;
  private myPeerId: PeerId;
  private pool: SimplePool;
  private subscription: ReturnType<SimplePool['subscribe']> | null = null;
  private peers = new Map<string, PeerInfo>();
  private helloInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers = new Set<WebRTCStoreEventHandler>();
  private running = false;
  private pendingReqs = new Map<Hash, PendingReq[]>();
  // Deduplicate concurrent get() calls for the same hash
  private pendingGets = new Map<string, Promise<Uint8Array | null>>();

  constructor(config: WebRTCStoreConfig) {
    this.signer = config.signer;
    this.encrypt = config.encrypt;
    this.decrypt = config.decrypt;
    this.myPeerId = new PeerId(config.pubkey, generateUuid());

    // Default classifier: everyone is 'other' unless classifier provided
    this.peerClassifier = config.peerClassifier ?? (() => 'other');

    // Use pool config if provided, otherwise fall back to legacy config or defaults
    if (config.pools) {
      this.pools = config.pools;
    } else {
      // Legacy mode: single pool with old config values
      const maxConn = config.maxConnections ?? 6;
      const satConn = config.satisfiedConnections ?? 3;
      this.pools = {
        follows: { maxConnections: 0, satisfiedConnections: 0 }, // No follows pool in legacy
        other: { maxConnections: maxConn, satisfiedConnections: satConn },
      };
    }

    this.config = {
      helloInterval: config.helloInterval ?? 10000,
      messageTimeout: config.messageTimeout ?? 15000,
      requestTimeout: config.requestTimeout ?? 5000,
      peerQueryDelay: config.peerQueryDelay ?? 500,
      relays: config.relays ?? DEFAULT_RELAYS,
      localStore: config.localStore ?? null,
      fallbackStores: config.fallbackStores ?? [],
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
   * Get pool counts
   */
  private getPoolCounts(): { follows: { connected: number; total: number }; other: { connected: number; total: number } } {
    const counts = {
      follows: { connected: 0, total: 0 },
      other: { connected: 0, total: 0 },
    };

    for (const { peer, pool } of this.peers.values()) {
      counts[pool].total++;
      if (peer.isConnected) {
        counts[pool].connected++;
      }
    }

    return counts;
  }

  /**
   * Check if we can accept a peer in a given pool
   */
  private canAcceptPeer(pool: PeerPool): boolean {
    const counts = this.getPoolCounts();
    return counts[pool].total < this.pools[pool].maxConnections;
  }

  /**
   * Check if a pool is satisfied
   */
  private isPoolSatisfied(pool: PeerPool): boolean {
    const counts = this.getPoolCounts();
    return counts[pool].connected >= this.pools[pool].satisfiedConnections;
  }

  /**
   * Start the WebRTC store - connect to relays and begin peer discovery
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.log('Starting with peerId:', this.myPeerId.short());
    this.log('Pool config:', this.pools);

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
    for (const { peer } of this.peers.values()) {
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
      const peerInfo = this.peers.get(peerIdStr);
      if (peerInfo) {
        await peerInfo.peer.handleSignaling(msg, this.myPeerId.uuid);
      }
    }
  }

  private async handleHello(peerUuid: string, senderPubkey: string): Promise<void> {
    const peerId = new PeerId(senderPubkey, peerUuid);

    // Skip self (exact same peerId = same session)
    if (peerId.toString() === this.myPeerId.toString()) {
      return;
    }

    // Check if we already have this peer
    if (this.peers.has(peerId.toString())) {
      return;
    }

    // Classify the peer
    const pool = this.peerClassifier(senderPubkey);

    // Check if we can accept this peer in their pool
    if (!this.canAcceptPeer(pool)) {
      this.log('Ignoring hello from', peerId.short(), '- pool', pool, 'is full');
      return;
    }

    this.log('Received hello from', peerId.short(), 'pool:', pool);

    // Tie-breaking: lower UUID initiates
    if (this.myPeerId.uuid < peerUuid) {
      await this.connectToPeer(peerId, pool);
    }
  }

  private async handleOffer(peerId: PeerId, msg: SignalingMessage): Promise<void> {
    // Skip self (exact same peerId)
    if (peerId.toString() === this.myPeerId.toString()) {
      return;
    }

    const peerIdStr = peerId.toString();

    // Classify the peer
    const pool = this.peerClassifier(peerId.pubkey);

    // Check if we can accept (unless we already have this peer)
    if (!this.peers.has(peerIdStr) && !this.canAcceptPeer(pool)) {
      this.log('Rejecting offer from', peerId.short(), '- pool', pool, 'is full');
      return;
    }

    // Clean up existing connection if any
    const existing = this.peers.get(peerIdStr);
    if (existing) {
      existing.peer.close();
      this.peers.delete(peerIdStr);
    }

    this.log('Accepting offer from', peerId.short(), 'pool:', pool);

    const peer = new Peer({
      peerId,
      direction: 'inbound',
      localStore: this.config.localStore,
      sendSignaling: (m) => this.sendSignaling(m, peerId.pubkey),
      onClose: () => this.handlePeerClose(peerIdStr),
      onConnected: () => {
        this.emit({ type: 'peer-connected', peerId: peerIdStr });
        this.emit({ type: 'update' });
        this.tryPendingReqs(peer);
      },
      onForwardRequest: (hash, exclude, htl) => this.forwardRequest(hash, exclude, htl),
      requestTimeout: this.config.requestTimeout,
      debug: this.config.debug,
    });

    this.peers.set(peerIdStr, { peer, pool });
    await peer.handleSignaling(msg, this.myPeerId.uuid);
  }

  private async connectToPeer(peerId: PeerId, pool: PeerPool): Promise<void> {
    const peerIdStr = peerId.toString();

    if (this.peers.has(peerIdStr)) {
      return;
    }

    this.log('Initiating connection to', peerId.short(), 'pool:', pool);

    const peer = new Peer({
      peerId,
      direction: 'outbound',
      localStore: this.config.localStore,
      sendSignaling: (m) => this.sendSignaling(m, peerId.pubkey),
      onClose: () => this.handlePeerClose(peerIdStr),
      onConnected: () => {
        this.emit({ type: 'peer-connected', peerId: peerIdStr });
        this.emit({ type: 'update' });
        this.tryPendingReqs(peer);
      },
      onForwardRequest: (hash, exclude, htl) => this.forwardRequest(hash, exclude, htl),
      requestTimeout: this.config.requestTimeout,
      debug: this.config.debug,
    });

    this.peers.set(peerIdStr, { peer, pool });
    await peer.connect(this.myPeerId.uuid);
  }

  private handlePeerClose(peerIdStr: string): void {
    this.peers.delete(peerIdStr);
    this.emit({ type: 'peer-disconnected', peerId: peerIdStr });
    this.emit({ type: 'update' });
  }

  /**
   * Forward a request to other peers (excluding the requester)
   * Called by Peer when it receives a request it can't fulfill locally
   * Uses sequential queries with delays between attempts
   * @param htl - Hops To Live (already decremented by calling peer)
   */
  private async forwardRequest(hash: Uint8Array, excludePeerId: string, htl: number): Promise<Uint8Array | null> {
    // Try all connected peers except the one who requested
    const otherPeers = Array.from(this.peers.values())
      .filter(({ peer }) => peer.isConnected && peer.peerId !== excludePeerId);

    // Sort: follows first
    otherPeers.sort((a, b) => {
      if (a.pool === 'follows' && b.pool !== 'follows') return -1;
      if (a.pool !== 'follows' && b.pool === 'follows') return 1;
      return 0;
    });

    // Query peers sequentially with delay between attempts
    for (let i = 0; i < otherPeers.length; i++) {
      const { peer } = otherPeers[i];

      // Start request to this peer with the decremented HTL
      const requestPromise = peer.request(hash, htl);

      // Race between request completing and delay timeout
      const result = await Promise.race([
        requestPromise.then(data => ({ type: 'data' as const, data })),
        this.delay(this.config.peerQueryDelay).then(() => ({ type: 'timeout' as const })),
      ]);

      if (result.type === 'data' && result.data) {
        // Got data from this peer
        if (this.config.localStore) {
          await this.config.localStore.put(hash, result.data);
        }
        return result.data;
      }

      // If timeout, continue to next peer
      if (result.type === 'timeout') {
        this.log('Forward: peer', peer.peerId.slice(0, 12), 'timeout, trying next');
      }
    }

    return null;
  }

  /**
   * Send data to all peers who have requested this hash
   * Called when we receive data that peers may be waiting for
   */
  sendToInterestedPeers(hash: Uint8Array, data: Uint8Array): number {
    let sendCount = 0;
    for (const { peer } of this.peers.values()) {
      if (peer.isConnected && peer.sendData(hash, data)) {
        sendCount++;
      }
    }
    if (sendCount > 0) {
      this.log('Sent data to', sendCount, 'interested peers for hash:', toHex(hash).slice(0, 16));
    }
    return sendCount;
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

    // Check if both pools are satisfied
    const followsSatisfied = this.isPoolSatisfied('follows');
    const otherSatisfied = this.isPoolSatisfied('other');

    if (followsSatisfied && otherSatisfied) {
      const counts = this.getPoolCounts();
      this.log('Satisfied - follows:', counts.follows.connected, 'other:', counts.other.connected);
      return;
    }

    const counts = this.getPoolCounts();
    this.log('Sending hello - follows:', counts.follows.connected, '/', this.pools.follows.satisfiedConnections,
             'other:', counts.other.connected, '/', this.pools.other.satisfiedConnections);
    this.sendSignaling({
      type: 'hello',
      peerId: this.myPeerId.uuid,
    });
  }

  private cleanupConnections(): void {
    const now = Date.now();
    const connectionTimeout = 15000; // 15 seconds to establish connection

    for (const [peerIdStr, { peer }] of this.peers) {
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
      .filter(({ peer }) => peer.isConnected).length;
  }

  /**
   * Get all peer statuses
   */
  getPeers(): PeerStatus[] {
    return Array.from(this.peers.values()).map(({ peer, pool }) => ({
      peerId: peer.peerId,
      pubkey: peer.pubkey,
      state: peer.state,
      direction: peer.direction,
      connectedAt: peer.connectedAt,
      isSelf: peer.pubkey === this.myPeerId.pubkey,
      pool,
    }));
  }

  /**
   * Get my peer ID (uuid part only)
   */
  getMyPeerId(): string {
    return this.myPeerId.uuid;
  }

  /**
   * Check if store is satisfied (has enough connections in all pools)
   */
  isSatisfied(): boolean {
    return this.isPoolSatisfied('follows') && this.isPoolSatisfied('other');
  }

  /**
   * Update peer classifier (e.g., when social graph updates)
   */
  setPeerClassifier(classifier: PeerClassifier): void {
    this.peerClassifier = classifier;
    // Re-classify existing peers (they keep their connections, just update pool assignment)
    for (const [peerIdStr, peerInfo] of this.peers) {
      const newPool = classifier(peerInfo.peer.pubkey);
      if (newPool !== peerInfo.pool) {
        this.log('Reclassified peer', peerIdStr.slice(0, 16), 'from', peerInfo.pool, 'to', newPool);
        peerInfo.pool = newPool;
      }
    }
    this.emit({ type: 'update' });
  }

  /**
   * Update pool configuration (e.g., from settings)
   */
  setPoolConfig(pools: { follows: PoolConfig; other: PoolConfig }): void {
    this.pools = pools;
    this.log('Pool config updated:', pools);
    // Existing connections remain, but new limits apply for future connections
    this.emit({ type: 'update' });
  }

  /**
   * Get current pool configuration
   */
  getPoolConfig(): { follows: PoolConfig; other: PoolConfig } {
    return { ...this.pools };
  }

  /**
   * Get fallback stores count
   */
  getFallbackStoresCount(): number {
    return this.config.fallbackStores.length;
  }

  // Store interface implementation

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    // Write to local store if available
    const success = this.config.localStore
      ? await this.config.localStore.put(hash, data)
      : false;

    // Send to any peers who have requested this hash
    this.sendToInterestedPeers(hash, data);

    return success;
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    // Guard against undefined hash
    if (!hash) return null;

    // Try local store first
    if (this.config.localStore) {
      const local = await this.config.localStore.get(hash);
      if (local) return local;
    }

    // Deduplicate: if there's already a pending request for this hash, wait for it
    const hashHex = toHex(hash);
    const pendingGet = this.pendingGets.get(hashHex);
    if (pendingGet) {
      this.log('Deduplicating get for hash:', hashHex.slice(0, 16));
      return pendingGet;
    }

    // Create the actual fetch promise
    const fetchPromise = this.fetchFromPeers(hash);

    // Store it for deduplication
    this.pendingGets.set(hashHex, fetchPromise);

    // Clean up when done
    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.pendingGets.delete(hashHex);
    }
  }

  /**
   * Internal method to fetch data from peers (separated for deduplication)
   */
  private async fetchFromPeers(hash: Hash): Promise<Uint8Array | null> {
    // Get currently connected peers (prioritize follows pool)
    const triedPeers = new Set<string>();
    const allPeers = Array.from(this.peers.values())
      .filter(({ peer }) => peer.isConnected);

    // Sort: follows first, then others
    allPeers.sort((a, b) => {
      if (a.pool === 'follows' && b.pool !== 'follows') return -1;
      if (a.pool !== 'follows' && b.pool === 'follows') return 1;
      return 0;
    });

    // Query peers sequentially with delay between attempts
    for (let i = 0; i < allPeers.length; i++) {
      const { peer } = allPeers[i];
      triedPeers.add(peer.peerId);

      // Start request to this peer
      const requestPromise = peer.request(hash);

      // Race between request completing and delay timeout
      // If request completes within delay, we're done
      // If delay passes first, start next peer while still waiting
      const result = await Promise.race([
        requestPromise.then(data => ({ type: 'data' as const, data })),
        this.delay(this.config.peerQueryDelay).then(() => ({ type: 'timeout' as const })),
      ]);

      if (result.type === 'data' && result.data) {
        // Got data from this peer
        if (this.config.localStore) {
          await this.config.localStore.put(hash, result.data);
        }
        return result.data;
      }

      // If timeout, continue to next peer but also await the original request
      // in case it eventually returns data
      if (result.type === 'timeout') {
        // Fire-and-forget: if this peer eventually responds, we'll miss it
        // but that's fine - we're trying the next peer
        this.log('Peer', peer.peerId.slice(0, 12), 'timeout after', this.config.peerQueryDelay, 'ms, trying next');
      }
    }

    // All WebRTC peers failed - try fallback stores in order
    if (this.config.fallbackStores.length > 0) {
      this.log('All peers failed, trying', this.config.fallbackStores.length, 'fallback stores');
      for (const store of this.config.fallbackStores) {
        try {
          const data = await store.get(hash);
          if (data) {
            this.log('Got data from fallback store');
            if (this.config.localStore) {
              await this.config.localStore.put(hash, data);
            }
            return data;
          }
        } catch (e) {
          this.log('Fallback store error:', e);
        }
      }
    }

    // If running and not satisfied, add to pending reqs and wait for new peers
    if (this.running && !this.isSatisfied()) {
      return this.waitForHash(hash, triedPeers);
    }

    return null;
  }

  /**
   * Helper to create a delay promise
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Add hash to pending requests list and wait for it to be resolved by peers
   * Also immediately tries any connected peers that weren't tried yet
   */
  private waitForHash(hash: Hash, triedPeers: Set<string>): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      // Use longer timeout for pending requests - we need to wait for peers to connect
      const reqTimeout = Math.max(this.config.requestTimeout * 6, 30000);
      const timeout = setTimeout(() => {
        this.removePendingReq(hash, req);
        resolve(null);
      }, reqTimeout);

      const req: PendingReq = { resolve, timeout, triedPeers };

      const existing = this.pendingReqs.get(hash);
      if (existing) {
        existing.push(req);
      } else {
        this.pendingReqs.set(hash, [req]);
      }

      this.log('Added to pending reqs:', hash.slice(0, 16), 'tried', triedPeers.size, 'peers');

      // Immediately try any connected peers that weren't tried yet
      // This handles the race condition where peers connect while we're setting up the request
      this.tryConnectedPeersForHash(hash);
    });
  }

  /**
   * Try all currently connected peers for a specific hash in the pending requests
   */
  private async tryConnectedPeersForHash(hash: Hash): Promise<void> {
    const reqs = this.pendingReqs.get(hash);
    if (!reqs || reqs.length === 0) return;

    // Get all connected peers
    const connectedPeers = Array.from(this.peers.values())
      .filter(({ peer }) => peer.isConnected)
      .map(({ peer }) => peer);

    for (const peer of connectedPeers) {
      const peerIdStr = peer.peerId;

      // Find requests that haven't tried this peer yet
      const untried = reqs.filter(r => !r.triedPeers.has(peerIdStr));
      if (untried.length === 0) continue;

      // Mark as tried
      for (const r of untried) {
        r.triedPeers.add(peerIdStr);
      }

      this.log('Trying pending req from connected peer:', hash.slice(0, 16));

      const data = await peer.request(hash);
      if (data) {
        // Store locally
        if (this.config.localStore) {
          await this.config.localStore.put(hash, data);
        }

        // Resolve all waiting requests
        const currentReqs = this.pendingReqs.get(hash);
        if (currentReqs) {
          for (const r of currentReqs) {
            clearTimeout(r.timeout);
            r.resolve(data);
          }
          this.pendingReqs.delete(hash);
        }

        this.log('Resolved pending req:', hash.slice(0, 16));
        return;
      }
    }
  }

  /**
   * Remove a pending request from the list
   */
  private removePendingReq(hash: Hash, req: PendingReq): void {
    const reqs = this.pendingReqs.get(hash);
    if (!reqs) return;

    const idx = reqs.indexOf(req);
    if (idx !== -1) {
      reqs.splice(idx, 1);
      if (reqs.length === 0) {
        this.pendingReqs.delete(hash);
      }
    }
  }

  /**
   * Try pending requests with a newly connected peer
   */
  private async tryPendingReqs(peer: Peer): Promise<void> {
    const peerIdStr = peer.peerId;

    for (const [hash, reqs] of this.pendingReqs.entries()) {
      // Find requests that haven't tried this peer yet
      const untried = reqs.filter(r => !r.triedPeers.has(peerIdStr));
      if (untried.length === 0) continue;

      // Mark as tried
      for (const r of untried) {
        r.triedPeers.add(peerIdStr);
      }

      this.log('Trying pending req from new peer:', hash.slice(0, 16));

      const data = await peer.request(hash);
      if (data) {
        // Store locally
        if (this.config.localStore) {
          await this.config.localStore.put(hash, data);
        }

        // Resolve all waiting requests
        for (const r of reqs) {
          clearTimeout(r.timeout);
          r.resolve(data);
        }
        this.pendingReqs.delete(hash);

        this.log('Resolved pending req:', hash.slice(0, 16));
      }
    }
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
