/**
 * NDK instance for Worker
 *
 * Runs NDK with:
 * - Real relay connections
 * - ndk-cache (Dexie) for IndexedDB caching
 * - nostr-wasm for fast signature verification
 *
 * Main thread communicates via WorkerAdapter postMessage.
 */

import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKFilter } from 'ndk';
import NDKCacheAdapterDexie from 'ndk-cache';
import { verifyEvent } from 'nostr-tools';
import type { SignedEvent, NostrFilter } from './protocol';

// NDK instance - initialized lazily
let ndk: NDK | null = null;

// nostr-wasm verifier interface
interface WasmVerifier {
  verifyEvent(event: unknown): void; // throws on invalid sig
}
let wasmVerifier: WasmVerifier | null = null;
let wasmLoading = false;

// Event callbacks
let onEventCallback: ((subId: string, event: SignedEvent) => void) | null = null;
let onEoseCallback: ((subId: string) => void) | null = null;

// Active subscriptions
const subscriptions = new Map<string, ReturnType<NDK['subscribe']>>();

/**
 * Lazy load nostr-wasm for signature verification
 * Runs in background - verification falls back to JS until loaded
 */
async function loadNostrWasm(): Promise<void> {
  if (wasmVerifier || wasmLoading) return;
  wasmLoading = true;

  try {
    const { initNostrWasm } = await import('nostr-wasm');
    wasmVerifier = await initNostrWasm();
    console.log('[Worker NDK] nostr-wasm loaded');
  } catch (err) {
    console.warn('[Worker NDK] nostr-wasm load failed, using JS fallback:', err);
  } finally {
    wasmLoading = false;
  }
}

/**
 * Custom signature verification function for NDK
 * Uses nostr-wasm if loaded, falls back to nostr-tools
 */
async function verifySignature(event: NDKEvent): Promise<boolean> {
  if (wasmVerifier) {
    try {
      // nostr-wasm verifyEvent checks both id hash and signature
      wasmVerifier.verifyEvent({
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: event.sig,
      });
      return true;
    } catch {
      return false;
    }
  }

  // Fallback to nostr-tools until wasm loads
  // Don't call event.verifySignature() - that would cause infinite recursion
  return verifyEvent({
    id: event.id!,
    pubkey: event.pubkey,
    created_at: event.created_at!,
    kind: event.kind!,
    tags: event.tags,
    content: event.content,
    sig: event.sig!,
  });
}

/**
 * Initialize NDK with cache and nostr-wasm
 */
export async function initNdk(
  relays: string[],
  options: {
    pubkey?: string;
    nsec?: string;
  } = {}
): Promise<void> {
  // Create cache adapter
  const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'hashtree-ndk-worker', eventCacheSize: 5000 });

  // Create NDK instance
  ndk = new NDK({
    explicitRelayUrls: relays,
    cacheAdapter,
    // Custom verification - will use wasm when loaded, JS fallback until then
    signatureVerificationFunction: verifySignature,
  });

  // Set up signer if nsec provided
  if (options.nsec) {
    ndk.signer = new NDKPrivateKeySigner(options.nsec);
  }

  // Connect to relays (non-blocking)
  ndk.connect().then(() => {
    console.log('[Worker NDK] All relays connected');
  });

  // Lazy load nostr-wasm in background
  loadNostrWasm();

  console.log('[Worker NDK] Initialized with', relays.length, 'relays');
}

/**
 * Get the NDK instance
 */
export function getNdk(): NDK | null {
  return ndk;
}

/**
 * Set event callback
 */
export function setOnEvent(callback: (subId: string, event: SignedEvent) => void): void {
  onEventCallback = callback;
}

/**
 * Set EOSE callback
 */
export function setOnEose(callback: (subId: string) => void): void {
  onEoseCallback = callback;
}

/**
 * Subscribe to events
 */
export function subscribe(subId: string, filters: NostrFilter[]): void {
  if (!ndk) {
    console.error('[Worker NDK] Not initialized');
    return;
  }

  // Close existing subscription with same ID
  unsubscribe(subId);

  // Convert NostrFilter to NDKFilter
  const ndkFilters: NDKFilter[] = filters.map(f => {
    const filter: NDKFilter = {
      ids: f.ids,
      authors: f.authors,
      kinds: f.kinds,
      since: f.since,
      until: f.until,
      limit: f.limit,
    };

    // Copy tag filters
    for (const key of Object.keys(f)) {
      if (key.startsWith('#')) {
        (filter as Record<string, unknown>)[key] = f[key];
      }
    }

    return filter;
  });

  // skipValidation: nostr-wasm verifyEvent handles structure validation
  const sub = ndk.subscribe(ndkFilters, { closeOnEose: false, skipValidation: true });

  sub.on('event', (event: NDKEvent) => {
    const signedEvent: SignedEvent = {
      id: event.id!,
      pubkey: event.pubkey,
      kind: event.kind!,
      content: event.content,
      tags: event.tags,
      created_at: event.created_at!,
      sig: event.sig!,
    };
    onEventCallback?.(subId, signedEvent);
  });

  sub.on('eose', () => {
    onEoseCallback?.(subId);
  });

  subscriptions.set(subId, sub);
  console.log('[Worker NDK] Subscribed:', subId);
}

/**
 * Unsubscribe
 */
export function unsubscribe(subId: string): void {
  const sub = subscriptions.get(subId);
  if (sub) {
    sub.stop();
    subscriptions.delete(subId);
    console.log('[Worker NDK] Unsubscribed:', subId);
  }
}

/**
 * Publish an event
 */
export async function publish(event: SignedEvent): Promise<void> {
  if (!ndk) {
    throw new Error('NDK not initialized');
  }

  const ndkEvent = new NDKEvent(ndk, {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at,
    sig: event.sig,
  });

  await ndkEvent.publish();
  console.log('[Worker NDK] Published:', event.id);
}

/**
 * Close NDK and all subscriptions
 */
export function closeNdk(): void {
  for (const [subId, sub] of subscriptions) {
    sub.stop();
    console.log('[Worker NDK] Closed subscription:', subId);
  }
  subscriptions.clear();

  // NDK doesn't have a close method, but we can disconnect relays
  if (ndk?.pool) {
    for (const relay of ndk.pool.relays.values()) {
      relay.disconnect();
    }
  }

  ndk = null;
  console.log('[Worker NDK] Closed');
}

/**
 * Get relay stats
 */
export function getRelayStats(): { url: string; connected: boolean; eventsReceived: number; eventsSent: number }[] {
  if (!ndk?.pool) return [];

  const stats: { url: string; connected: boolean; eventsReceived: number; eventsSent: number }[] = [];

  for (const relay of ndk.pool.relays.values()) {
    stats.push({
      url: relay.url,
      connected: relay.status >= 5, // NDKRelayStatus.CONNECTED = 5
      eventsReceived: 0, // TODO: track this
      eventsSent: 0,
    });
  }

  return stats;
}
