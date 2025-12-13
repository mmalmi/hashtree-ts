/**
 * WebRTC signaling types for hashtree P2P connections
 */

// Signaling message types
export interface HelloMessage {
  type: 'hello';
  peerId: string;
}

export interface OfferMessage {
  type: 'offer';
  offer: RTCSessionDescriptionInit;
  recipient: string;
  peerId: string;
}

export interface AnswerMessage {
  type: 'answer';
  answer: RTCSessionDescriptionInit;
  recipient: string;
  peerId: string;
}

export interface CandidateMessage {
  type: 'candidate';
  candidate: RTCIceCandidateInit;
  recipient: string;
  peerId: string;
}

export interface CandidatesMessage {
  type: 'candidates';
  candidates: RTCIceCandidateInit[];
  recipient: string;
  peerId: string;
}

export type SignalingMessage = HelloMessage | OfferMessage | AnswerMessage | CandidateMessage | CandidatesMessage;

// Directed messages (have recipient) - excludes HelloMessage
export type DirectedMessage = OfferMessage | AnswerMessage | CandidateMessage | CandidatesMessage;

// HTL (Hops To Live) constants - Freenet-style probabilistic decrement
export const MAX_HTL = 10;
export const DECREMENT_AT_MAX_PROB = 0.5;  // 50% chance to decrement at max
export const DECREMENT_AT_MIN_PROB = 0.25; // 25% chance to decrement at 1

// Message type bytes (prefix before MessagePack body)
export const MSG_TYPE_REQUEST = 0x00;
export const MSG_TYPE_RESPONSE = 0x01;

// Data channel protocol messages
// Wire format: [type byte][msgpack body]
// Request:  [0x00][msgpack: {h: bytes32, htl?: u8}]
// Response: [0x01][msgpack: {h: bytes32, d: bytes}]

export interface DataRequest {
  h: Uint8Array;   // 32-byte hash
  htl?: number;    // Hops To Live (default MAX_HTL if not set)
}

export interface DataResponse {
  h: Uint8Array;   // 32-byte hash
  d: Uint8Array;   // Data
}

export type DataMessage =
  | { type: typeof MSG_TYPE_REQUEST; body: DataRequest }
  | { type: typeof MSG_TYPE_RESPONSE; body: DataResponse };

// Signer function type (compatible with window.nostr.signEvent)
export type EventSigner = (event: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}) => Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>;

// Encrypter function type (compatible with window.nostr.nip04.encrypt)
export type EventEncrypter = (pubkey: string, plaintext: string) => Promise<string>;

// Decrypter function type (compatible with window.nostr.nip04.decrypt)
export type EventDecrypter = (pubkey: string, ciphertext: string) => Promise<string>;

// Peer pool types for prioritized connections
export type PeerPool = 'follows' | 'other';

// Function to classify a peer into a pool based on pubkey
export type PeerClassifier = (pubkey: string) => PeerPool;

// Pool configuration
export interface PoolConfig {
  maxConnections: number;
  satisfiedConnections: number;
}

// Configuration
export interface WebRTCStoreConfig {
  signer: EventSigner;            // NIP-07 compatible signer
  pubkey: string;                 // signer's pubkey
  encrypt: EventEncrypter;        // NIP-04 compatible encrypter
  decrypt: EventDecrypter;        // NIP-04 compatible decrypter
  satisfiedConnections?: number;  // default 3 (legacy, used if no pools)
  maxConnections?: number;        // default 6 (legacy, used if no pools)
  helloInterval?: number;         // default 10000ms
  messageTimeout?: number;        // default 15000ms
  requestTimeout?: number;        // default 5000ms
  peerQueryDelay?: number;        // default 500ms - delay between sequential peer queries
  relays?: string[];
  localStore?: import('../types.js').Store;
  debug?: boolean;
  // Pool-based peer management
  peerClassifier?: PeerClassifier;
  pools?: {
    follows: PoolConfig;
    other: PoolConfig;
  };
  // Fallback stores to try when WebRTC peers don't have the data
  // Tried in order after all WebRTC peers fail
  // Example: [new BlossomStore({ servers: ['https://hashtree.iris.to'] })]
  fallbackStores?: import('../types.js').Store[];
}

export interface PeerStatus {
  peerId: string;
  pubkey: string;
  state: RTCPeerConnectionState | 'connected';
  direction: 'inbound' | 'outbound';
  connectedAt?: number;
  isSelf?: boolean;
  pool?: PeerPool;
}

export type WebRTCStoreEvent =
  | { type: 'peer-connected'; peerId: string }
  | { type: 'peer-disconnected'; peerId: string }
  | { type: 'update' };

export type WebRTCStoreEventHandler = (event: WebRTCStoreEvent) => void;

// Stats tracking
export interface WebRTCStats {
  requestsSent: number;           // Requests we sent to peers
  requestsReceived: number;       // Requests we received from peers
  responsesSent: number;          // Responses we sent to peers
  responsesReceived: number;      // Responses we received from peers
  receiveErrors: number;          // Errors handling incoming messages (parse, hash mismatch, etc)
  blossomFetches: number;         // Successful fetches from blossom fallback stores
}

export function generateUuid(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

export class PeerId {
  readonly pubkey: string;
  readonly uuid: string;
  private readonly str: string;

  constructor(pubkey: string, uuid?: string) {
    this.pubkey = pubkey;
    this.uuid = uuid || generateUuid();
    this.str = `${pubkey}:${this.uuid}`;
  }

  toString(): string {
    return this.str;
  }

  short(): string {
    return `${this.pubkey.slice(0, 8)}:${this.uuid.slice(0, 6)}`;
  }

  static fromString(str: string): PeerId {
    const [pubkey, uuid] = str.split(':');
    if (!pubkey || !uuid) {
      throw new Error(`Invalid peer string: ${str}`);
    }
    return new PeerId(pubkey, uuid);
  }
}
