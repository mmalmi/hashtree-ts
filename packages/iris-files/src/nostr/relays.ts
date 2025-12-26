/**
 * Relay Management
 */
import { ndk } from './ndk';
import { nostrStore, type RelayStatus, type RelayInfo } from './store';
import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../stores/settings';

// NDKRelayStatus constants
const NDK_RELAY_STATUS_CONNECTING = 4;
const NDK_RELAY_STATUS_CONNECTED = 5;

function ndkStatusToRelayStatus(ndkStatus: number): RelayStatus {
  if (ndkStatus >= NDK_RELAY_STATUS_CONNECTED) return 'connected';
  if (ndkStatus === NDK_RELAY_STATUS_CONNECTING) return 'connecting';
  return 'disconnected';
}

// Normalize relay URL (remove trailing slash)
export function normalizeRelayUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function updateConnectedRelayCount(): void {
  const pool = ndk.pool;
  if (!pool) {
    nostrStore.setConnectedRelays(0);
    return;
  }

  let connected = 0;
  const statuses = new Map<string, RelayStatus>();
  const discoveredRelays: RelayInfo[] = [];

  // Get configured relays from settings or use defaults
  const settings = settingsStore.getState();
  const configuredRelays = settings.network?.relays?.length > 0
    ? settings.network.relays
    : DEFAULT_NETWORK_SETTINGS.relays;

  // Normalize configured relays for comparison
  const configuredNormalized = new Set(configuredRelays.map(normalizeRelayUrl));

  // Initialize all configured relays as disconnected
  for (const url of configuredRelays) {
    statuses.set(normalizeRelayUrl(url), 'disconnected');
  }

  // Update with actual statuses from pool
  for (const relay of pool.relays.values()) {
    const status = ndkStatusToRelayStatus(relay.status);
    const normalizedUrl = normalizeRelayUrl(relay.url);

    if (configuredNormalized.has(normalizedUrl)) {
      statuses.set(normalizedUrl, status);
    } else {
      discoveredRelays.push({ url: normalizedUrl, status });
    }

    if (relay.status >= NDK_RELAY_STATUS_CONNECTED) {
      connected++;
    }
  }

  discoveredRelays.sort((a, b) => a.url.localeCompare(b.url));

  nostrStore.setConnectedRelays(connected);
  nostrStore.setRelayStatuses(statuses);
  nostrStore.setDiscoveredRelays(discoveredRelays);
}

/**
 * Update NDK relay URLs from settings.
 */
export async function updateNdkRelays(): Promise<void> {
  const settings = settingsStore.getState();
  const relays = settings.network?.relays?.length > 0
    ? settings.network.relays
    : DEFAULT_NETWORK_SETTINGS.relays;

  nostrStore.setRelays(relays);
  nostrStore.setRelayStatuses(new Map(relays.map(url => [normalizeRelayUrl(url), 'disconnected' as RelayStatus])));

  for (const relay of ndk.pool?.relays.values() ?? []) {
    ndk.pool?.removeRelay(relay.url);
  }

  for (const url of relays) {
    ndk.addExplicitRelay(url);
  }

  await ndk.connect();
  updateConnectedRelayCount();
}

/**
 * Initialize relay tracking
 */
export function initRelayTracking(): void {
  // Listen for relay connect/disconnect events
  ndk.pool?.on('relay:connect', () => updateConnectedRelayCount());
  ndk.pool?.on('relay:disconnect', () => updateConnectedRelayCount());

  // Poll periodically in case events are missed
  setInterval(updateConnectedRelayCount, 2000);

  // Initial counts
  setTimeout(updateConnectedRelayCount, 500);
  setTimeout(updateConnectedRelayCount, 1500);
  setTimeout(updateConnectedRelayCount, 3000);

  // Update NDK relays when settings change
  let prevNetworkSettings = settingsStore.getState().network;
  let prevRelaysJson = JSON.stringify(prevNetworkSettings?.relays);

  settingsStore.subscribe((state) => {
    if (state.networkLoaded && state.network !== prevNetworkSettings) {
      const newRelaysJson = JSON.stringify(state.network?.relays);
      const relaysChanged = newRelaysJson !== prevRelaysJson;

      prevNetworkSettings = state.network;
      prevRelaysJson = newRelaysJson;

      if (relaysChanged) {
        updateNdkRelays().catch(console.error);
      }
    }
  });
}

// Initialize relay tracking
initRelayTracking();
