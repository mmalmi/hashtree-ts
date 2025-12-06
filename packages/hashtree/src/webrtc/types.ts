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

// Data channel protocol messages
export interface DataRequest {
  type: 'req';
  id: number;
  hash: string;
}

export interface DataResponse {
  type: 'res';
  id: number;
  hash: string;
  found: boolean;
  // data sent as binary after JSON header
}

// Forwarded data - when we receive data that a peer requested
export interface DataPush {
  type: 'push';
  hash: string;
  // data sent as binary after JSON header
}

export interface DataHave {
  type: 'have';
  hashes: string[];
}

export interface DataWant {
  type: 'want';
  hashes: string[];
}

export interface RootUpdate {
  type: 'root';
  hash: string;
}

export type DataMessage = DataRequest | DataResponse | DataPush | DataHave | DataWant | RootUpdate;

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
  // WebSocket fallback URL for data relay when WebRTC fails
  // Defaults to 'wss://hashtree.iris.to/ws/data'
  // Set to null to disable fallback
  wsFallbackUrl?: string | null;
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
