/**
 * Worker Protocol Types
 *
 * Message types for communication between main thread and hashtree worker.
 * Worker owns: HashTree, OpfsStore, WebRTC, Nostr (via nostr-tools)
 * Main thread owns: UI, NIP-07 extension access (signing/encryption)
 */

import type { CID } from '../types';

// Nostr types (simplified - don't want full nostr-tools dependency in protocol)
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#e'?: string[];
  '#p'?: string[];
  '#d'?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: string[] | number[] | number | undefined;
}

// SocialGraph event type (kind 3 contact list events)
export interface SocialGraphEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  sig: string;
}

export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey?: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export interface PeerStats {
  peerId: string;
  pubkey: string;
  connected: boolean;
  requestsSent: number;
  requestsReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

// ============================================================================
// Main Thread → Worker Messages
// ============================================================================

export type WorkerRequest =
  // Lifecycle
  | { type: 'init'; id: string; config: WorkerConfig }
  | { type: 'close'; id: string }

  // Store operations (low-level hash-based)
  | { type: 'get'; id: string; hash: Uint8Array }
  | { type: 'put'; id: string; hash: Uint8Array; data: Uint8Array }
  | { type: 'has'; id: string; hash: Uint8Array }
  | { type: 'delete'; id: string; hash: Uint8Array }

  // Tree operations (high-level CID-based)
  | { type: 'readFile'; id: string; cid: CID }
  | { type: 'readFileRange'; id: string; cid: CID; start: number; end?: number }
  | { type: 'readFileStream'; id: string; cid: CID }
  | { type: 'writeFile'; id: string; parentCid: CID | null; path: string; data: Uint8Array }
  | { type: 'deleteFile'; id: string; parentCid: CID; path: string }
  | { type: 'listDir'; id: string; cid: CID }
  | { type: 'resolveRoot'; id: string; npub: string; path?: string }

  // Nostr subscriptions
  | { type: 'subscribe'; id: string; filters: NostrFilter[] }
  | { type: 'unsubscribe'; id: string; subId: string }
  | { type: 'publish'; id: string; event: SignedEvent }

  // Media streaming (service worker registers a MessagePort)
  | { type: 'registerMediaPort'; port: MessagePort }

  // Stats
  | { type: 'getPeerStats'; id: string }
  | { type: 'getRelayStats'; id: string }

  // SocialGraph operations
  | { type: 'initSocialGraph'; id: string; rootPubkey?: string }
  | { type: 'setSocialGraphRoot'; id: string; pubkey: string }
  | { type: 'handleSocialGraphEvents'; id: string; events: SocialGraphEvent[] }
  | { type: 'getFollowDistance'; id: string; pubkey: string }
  | { type: 'isFollowing'; id: string; follower: string; followed: string }
  | { type: 'getFollows'; id: string; pubkey: string }
  | { type: 'getFollowers'; id: string; pubkey: string }
  | { type: 'getFollowedByFriends'; id: string; pubkey: string }
  | { type: 'getSocialGraphSize'; id: string }
  | { type: 'getUsersByDistance'; id: string; distance: number }

  // NIP-07 responses (main thread → worker, after signing/encryption)
  | { type: 'signed'; id: string; event?: SignedEvent; error?: string }
  | { type: 'encrypted'; id: string; ciphertext?: string; error?: string }
  | { type: 'decrypted'; id: string; plaintext?: string; error?: string };

export interface WorkerConfig {
  relays: string[];
  pubkey?: string;  // User's pubkey for subscriptions
  storeName?: string;  // OPFS directory name, defaults to 'hashtree'
}

// ============================================================================
// Worker → Main Thread Messages
// ============================================================================

export type WorkerResponse =
  // Lifecycle
  | { type: 'ready' }
  | { type: 'error'; id?: string; error: string }

  // Generic responses
  | { type: 'result'; id: string; data?: Uint8Array; error?: string }
  | { type: 'bool'; id: string; value: boolean; error?: string }
  | { type: 'cid'; id: string; cid?: CID; error?: string }
  | { type: 'void'; id: string; error?: string }

  // Tree operations
  | { type: 'dirListing'; id: string; entries?: DirEntry[]; error?: string }
  | { type: 'streamChunk'; id: string; chunk: Uint8Array; done: boolean }

  // Nostr events
  | { type: 'event'; subId: string; event: SignedEvent }
  | { type: 'eose'; subId: string }

  // Stats
  | { type: 'peerStats'; id: string; stats: PeerStats[] }
  | { type: 'relayStats'; id: string; stats: RelayStats[] }

  // SocialGraph responses
  | { type: 'socialGraphReady'; id: string; version: number; size: number }
  | { type: 'socialGraphVersion'; version: number }
  | { type: 'followDistance'; id: string; distance: number }
  | { type: 'isFollowingResult'; id: string; result: boolean }
  | { type: 'pubkeyList'; id: string; pubkeys: string[] }
  | { type: 'socialGraphSize'; id: string; size: number }

  // NIP-07 requests (worker → main thread, needs extension)
  | { type: 'signEvent'; id: string; event: UnsignedEvent }
  | { type: 'nip44Encrypt'; id: string; pubkey: string; plaintext: string }
  | { type: 'nip44Decrypt'; id: string; pubkey: string; ciphertext: string };

export interface DirEntry {
  name: string;
  isDir: boolean;
  size?: number;
  cid?: CID;
}

export interface RelayStats {
  url: string;
  connected: boolean;
  eventsReceived: number;
  eventsSent: number;
}

// ============================================================================
// Service Worker ↔ Worker Messages (via MessagePort)
// ============================================================================

// Request by direct CID (for cached/known content)
export interface MediaRequestByCid {
  type: 'media';
  requestId: string;
  cid: string;  // hex encoded CID hash
  start: number;
  end?: number;
  mimeType?: string;
}

// Request by npub/path (supports live streaming via tree root updates)
export interface MediaRequestByPath {
  type: 'mediaByPath';
  requestId: string;
  npub: string;
  path: string;  // e.g., "public/video.webm"
  start: number;
  end?: number;
  mimeType?: string;
}

export type MediaRequest = MediaRequestByCid | MediaRequestByPath;

export type MediaResponse =
  | { type: 'headers'; requestId: string; totalSize: number; mimeType: string; isLive?: boolean }
  | { type: 'chunk'; requestId: string; data: Uint8Array }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

// ============================================================================
// Helper functions
// ============================================================================

let requestIdCounter = 0;

export function generateRequestId(): string {
  return `req_${Date.now()}_${++requestIdCounter}`;
}
