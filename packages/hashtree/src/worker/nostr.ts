/**
 * Nostr Relay Manager for Worker
 *
 * Manages WebSocket connections to Nostr relays using NDK.
 * Provides subscribe/publish functionality for the worker.
 *
 * Used for:
 * - WebRTC signaling (kind 25050 ephemeral)
 * - Tree root resolution (kind 30078)
 */

import NDK, { NDKEvent, NDKSubscription, type NDKFilter, type NDKSigner } from '@nostr-dev-kit/ndk';
import type { NostrFilter, SignedEvent, RelayStats } from './protocol';

// Subscription entry
interface Subscription {
  id: string;
  filters: NostrFilter[];
  ndkSub: NDKSubscription;
}

export class NostrManager {
  private ndk: NDK;
  private subscriptions = new Map<string, Subscription>();
  private onEvent: ((subId: string, event: SignedEvent) => void) | null = null;
  private onEose: ((subId: string) => void) | null = null;
  private initialized = false;

  constructor() {
    this.ndk = new NDK({
      // No explicit relays yet - will be set in init()
      autoConnectUserRelays: false,
    });
  }

  /**
   * Initialize with relay URLs
   */
  async init(relays: string[]): Promise<void> {
    // Add relays to NDK
    for (const url of relays) {
      this.ndk.addExplicitRelay(url);
    }

    // Connect to relays
    await this.ndk.connect();
    this.initialized = true;

    console.log('[NostrManager] Initialized with relays:', relays);
  }

  /**
   * Set event callback
   */
  setOnEvent(callback: (subId: string, event: SignedEvent) => void): void {
    this.onEvent = callback;
  }

  /**
   * Set EOSE callback
   */
  setOnEose(callback: (subId: string) => void): void {
    this.onEose = callback;
  }

  /**
   * Convert NostrFilter to NDKFilter
   */
  private toNDKFilter(filter: NostrFilter): NDKFilter {
    const ndkFilter: NDKFilter = {};

    if (filter.ids) ndkFilter.ids = filter.ids;
    if (filter.authors) ndkFilter.authors = filter.authors;
    if (filter.kinds) ndkFilter.kinds = filter.kinds;
    if (filter['#e']) ndkFilter['#e'] = filter['#e'];
    if (filter['#p']) ndkFilter['#p'] = filter['#p'];
    if (filter['#d']) ndkFilter['#d'] = filter['#d'];
    if (filter.since) ndkFilter.since = filter.since;
    if (filter.until) ndkFilter.until = filter.until;
    if (filter.limit) ndkFilter.limit = filter.limit;

    // Handle arbitrary tag filters (e.g., #l, #t, etc.)
    for (const key of Object.keys(filter)) {
      if (key.startsWith('#') && !['#e', '#p', '#d'].includes(key)) {
        const value = filter[key];
        if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
          (ndkFilter as Record<string, string[]>)[key] = value as string[];
        }
      }
    }

    return ndkFilter;
  }

  /**
   * Convert NDKEvent to SignedEvent
   */
  private toSignedEvent(event: NDKEvent): SignedEvent {
    return {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind!,
      content: event.content,
      tags: event.tags,
      created_at: event.created_at!,
      sig: event.sig!,
    };
  }

  /**
   * Subscribe to events matching filters
   */
  subscribe(subId: string, filters: NostrFilter[]): void {
    // Close existing subscription with same ID if any
    this.unsubscribe(subId);

    // Convert filters to NDK format
    const ndkFilters = filters.map(f => this.toNDKFilter(f));

    // Create NDK subscription
    const ndkSub = this.ndk.subscribe(ndkFilters, {
      closeOnEose: false,
    });

    // Handle events
    ndkSub.on('event', (event: NDKEvent) => {
      const signedEvent = this.toSignedEvent(event);
      this.onEvent?.(subId, signedEvent);
    });

    // Handle EOSE
    ndkSub.on('eose', () => {
      this.onEose?.(subId);
    });

    // Store subscription
    this.subscriptions.set(subId, { id: subId, filters, ndkSub });
    console.log('[NostrManager] Subscribed:', subId, filters);
  }

  /**
   * Unsubscribe from a subscription
   */
  unsubscribe(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.ndkSub.stop();
      this.subscriptions.delete(subId);
      console.log('[NostrManager] Unsubscribed:', subId);
    }
  }

  /**
   * Publish an event to all relays
   */
  async publish(event: SignedEvent): Promise<void> {
    // Create NDKEvent from SignedEvent
    const ndkEvent = new NDKEvent(this.ndk);
    ndkEvent.id = event.id;
    ndkEvent.pubkey = event.pubkey;
    ndkEvent.kind = event.kind;
    ndkEvent.content = event.content;
    ndkEvent.tags = event.tags;
    ndkEvent.created_at = event.created_at;
    ndkEvent.sig = event.sig;

    try {
      // Publish to relays (event is already signed)
      await ndkEvent.publish();
      console.log('[NostrManager] Published event:', event.id);
    } catch (err) {
      console.error('[NostrManager] Failed to publish:', err);
      throw err;
    }
  }

  /**
   * Get relay connection stats
   */
  getRelayStats(): RelayStats[] {
    const result: RelayStats[] = [];

    for (const relay of this.ndk.pool.relays.values()) {
      result.push({
        url: relay.url,
        connected: relay.status === 1, // WebSocket.OPEN
        eventsReceived: 0, // NDK doesn't expose this directly
        eventsSent: 0,
      });
    }

    return result;
  }

  /**
   * Add a relay dynamically
   */
  addRelay(url: string): void {
    this.ndk.addExplicitRelay(url);
  }

  /**
   * Remove a relay dynamically
   */
  removeRelay(url: string): void {
    const relay = this.ndk.pool.relays.get(url);
    if (relay) {
      relay.disconnect();
      this.ndk.pool.relays.delete(url);
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Set the NDK signer (for signing events with user identity)
   */
  setSigner(signer: NDKSigner): void {
    this.ndk.signer = signer;
  }

  /**
   * Get the NDK instance (for advanced usage)
   */
  getNdk(): NDK {
    return this.ndk;
  }

  /**
   * Close all subscriptions and connections
   */
  close(): void {
    for (const [subId, sub] of this.subscriptions) {
      sub.ndkSub.stop();
      console.log('[NostrManager] Closed subscription:', subId);
    }
    this.subscriptions.clear();

    // Disconnect all relays
    for (const relay of this.ndk.pool.relays.values()) {
      relay.disconnect();
    }

    this.initialized = false;
    console.log('[NostrManager] Closed');
  }
}

// Singleton instance for the worker
let instance: NostrManager | null = null;

export function getNostrManager(): NostrManager {
  if (!instance) {
    instance = new NostrManager();
  }
  return instance;
}

export function closeNostrManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
