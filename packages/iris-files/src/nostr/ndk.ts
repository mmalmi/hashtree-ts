/**
 * NDK Setup and Configuration
 */
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKNip07Signer, type NostrEvent } from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { DEFAULT_NETWORK_SETTINGS } from '../stores/settings';

// NDK instance with Dexie cache (with size limits to prevent memory bloat)
const cacheAdapter = new NDKCacheAdapterDexie({
  dbName: 'hashtree-ndk-cache',
  // Limit in-memory cache sizes to prevent memory bloat
  profileCacheSize: 500,
  eventCacheSize: 2000,
  eventTagsCacheSize: 5000,
  nip05CacheSize: 200,
  zapperCacheSize: 200,
});

// Block ws:// relays when on HTTPS page (browser blocks mixed content anyway)
const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
const relayConnectionFilter = isSecurePage
  ? (url: string) => url.startsWith('wss://')
  : undefined;

export const ndk = new NDK({
  explicitRelayUrls: DEFAULT_NETWORK_SETTINGS.relays,
  // @ts-expect-error - NDK cache adapter version mismatch
  cacheAdapter,
  relayConnectionFilter,
});

// Expose NDK on window for debugging
if (typeof window !== 'undefined') {
  (window as Window & { __ndk?: NDK }).__ndk = ndk;
}

// Connect on init
ndk.connect().catch(console.error);

/**
 * Unified sign function - works with both nsec and extension login
 */
export async function signEvent(event: NostrEvent): Promise<NostrEvent> {
  if (!ndk.signer) {
    throw new Error('No signing method available');
  }
  const ndkEvent = new NDKEvent(ndk, event);
  await ndkEvent.sign();
  return ndkEvent.rawEvent() as NostrEvent;
}

// Re-export for convenience
export { NDKEvent, NDKPrivateKeySigner, NDKNip07Signer, type NostrEvent };
