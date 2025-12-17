/**
 * Nostr integration for HashTree Explorer
 * Uses NDK with Dexie cache for IndexedDB persistence
 * Svelte version using writable stores
 */
import { writable, get } from 'svelte/store';
import {
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  finalizeEvent,
} from 'nostr-tools';
import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKNip07Signer,
  type NostrEvent,
} from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { initWebRTC, stopWebRTC } from './store';
import { startBackgroundSync, stopBackgroundSync } from './services/backgroundSync';
import {
  toHex,
  type EventSigner,
  type GiftWrapper,
  type GiftUnwrapper,
  type CID,
  type TreeVisibility,
  visibilityHex,
} from 'hashtree';
import { settingsStore, DEFAULT_NETWORK_SETTINGS } from './stores/settings';
import { updateLocalRootCacheHex } from './treeRootCache';
import {
  accountsStore,
  initAccountsStore,
  createAccountFromNsec,
  createExtensionAccount,
  saveActiveAccountToStorage,
} from './accounts';
import { parseRoute } from './utils/route';

// Storage keys
const STORAGE_KEY_NSEC = 'hashtree:nsec';
const STORAGE_KEY_LOGIN_TYPE = 'hashtree:loginType';

// Re-export TreeVisibility from hashtree lib
export type { TreeVisibility } from 'hashtree';

export interface HashTreeEvent {
  id: string;
  pubkey: string;
  name: string;
  /** Root hash (hex encoded) */
  rootHash: string;
  /** Decryption key for encrypted trees (hex encoded) - present for public trees */
  rootKey?: string;
  /** Encrypted key (hex) - present for unlisted trees, decrypt with link key */
  encryptedKey?: string;
  /** Key ID for unlisted trees - hash of link decryption key, allows key rotation */
  keyId?: string;
  /** Self-encrypted key (NIP-04) - present for private trees */
  selfEncryptedKey?: string;
  /** Computed visibility based on which tags are present */
  visibility: TreeVisibility;
  created_at: number;
}

// Relay status type
export type RelayStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RelayInfo {
  url: string;
  status: RelayStatus;
}

// Nostr state interface
interface NostrState {
  pubkey: string | null;
  npub: string | null;
  isLoggedIn: boolean;
  selectedTree: HashTreeEvent | null;
  relays: string[];
  relayStatuses: Map<string, RelayStatus>;
  connectedRelays: number;
  /** Relays discovered by NDK (outbox model, etc) that aren't in configured list */
  discoveredRelays: RelayInfo[];
}

// Create Svelte store for nostr state
function createNostrStore() {
  const defaultRelays = DEFAULT_NETWORK_SETTINGS.relays;
  const { subscribe, update } = writable<NostrState>({
    pubkey: null,
    npub: null,
    isLoggedIn: false,
    selectedTree: null,
    relays: defaultRelays,
    relayStatuses: new Map(defaultRelays.map(url => [url, 'disconnected' as RelayStatus])),
    connectedRelays: 0,
    discoveredRelays: [],
  });

  return {
    subscribe,

    setPubkey: (pk: string | null) => {
      update(state => ({ ...state, pubkey: pk }));
    },

    setNpub: (npub: string | null) => {
      update(state => ({ ...state, npub }));
    },

    setIsLoggedIn: (loggedIn: boolean) => {
      update(state => ({ ...state, isLoggedIn: loggedIn }));
    },

    setSelectedTree: (tree: HashTreeEvent | null) => {
      update(state => ({ ...state, selectedTree: tree }));
    },

    setRelays: (relays: string[]) => {
      update(state => ({ ...state, relays }));
    },

    setConnectedRelays: (count: number) => {
      update(state => ({ ...state, connectedRelays: count }));
    },

    setRelayStatus: (url: string, status: RelayStatus) => {
      update(state => {
        const newStatuses = new Map(state.relayStatuses);
        newStatuses.set(url, status);
        return { ...state, relayStatuses: newStatuses };
      });
    },

    setRelayStatuses: (statuses: Map<string, RelayStatus>) => {
      update(state => ({ ...state, relayStatuses: statuses }));
    },

    setDiscoveredRelays: (relays: RelayInfo[]) => {
      update(state => ({ ...state, discoveredRelays: relays }));
    },

    // Get current state synchronously
    getState: (): NostrState => get(nostrStore),

    // Set state directly
    setState: (newState: Partial<NostrState>) => {
      update(state => ({ ...state, ...newState }));
    },
  };
}

// Use existing store from window if available (ensures singleton even with HMR/dynamic imports)
const existingStore = typeof window !== 'undefined' ? window.__nostrStore : null;

export const nostrStore = existingStore || createNostrStore();

// Expose singleton on window immediately
if (typeof window !== 'undefined') {
  window.__nostrStore = nostrStore;
}

// Legacy compatibility alias
export const useNostrStore = nostrStore;

// Private key (only set for nsec login)
let secretKey: Uint8Array | null = null;

/**
 * Get the secret key for decryption (only available for nsec login)
 * Returns null for extension logins
 */
export function getSecretKey(): Uint8Array | null {
  return secretKey;
}

/**
 * Get the nsec string (only available for nsec login)
 * Returns null for extension logins
 */
export function getNsec(): string | null {
  if (!secretKey) return null;
  return nip19.nsecEncode(secretKey);
}

// NDK instance with Dexie cache
const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'hashtree-ndk-cache' });

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
  window.__ndk = ndk;
}

// Connect on init
ndk.connect().catch(console.error);

/**
 * Update NDK relay URLs from settings.
 * Called when settings are loaded or changed.
 */
export async function updateNdkRelays() {
  const settings = settingsStore.getState();
  const relays = settings.network?.relays?.length > 0
    ? settings.network.relays
    : DEFAULT_NETWORK_SETTINGS.relays;

  // Update nostr store with configured relays
  nostrStore.setRelays(relays);
  nostrStore.setRelayStatuses(new Map(relays.map(url => [normalizeRelayUrl(url), 'disconnected' as RelayStatus])));

  // Clear existing relays and add new ones
  for (const relay of ndk.pool?.relays.values() ?? []) {
    ndk.pool?.removeRelay(relay.url);
  }

  // Add configured relays
  for (const url of relays) {
    ndk.addExplicitRelay(url);
  }

  // Reconnect
  await ndk.connect();
  updateConnectedRelayCount();
}

// Track connected relay count and individual statuses
// NDKRelayStatus: DISCONNECTED=0, DISCONNECTING=1, RECONNECTING=2, FLAPPING=3, CONNECTING=4,
//                 CONNECTED=5, AUTH_REQUESTED=6, AUTHENTICATING=7, AUTHENTICATED=8
const NDK_RELAY_STATUS_CONNECTING = 4;
const NDK_RELAY_STATUS_CONNECTED = 5;

function ndkStatusToRelayStatus(ndkStatus: number): RelayStatus {
  if (ndkStatus >= NDK_RELAY_STATUS_CONNECTED) return 'connected';
  if (ndkStatus === NDK_RELAY_STATUS_CONNECTING) return 'connecting';
  return 'disconnected';
}

// Normalize relay URL (remove trailing slash)
function normalizeRelayUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function updateConnectedRelayCount() {
  const pool = ndk.pool;
  if (!pool) {
    nostrStore.setConnectedRelays(0);
    return;
  }
  // Count relays with connected status (>= CONNECTED) and track individual statuses
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
      // Configured relay - update its status
      statuses.set(normalizedUrl, status);
    } else {
      // Discovered relay - add to discovered list
      discoveredRelays.push({ url: normalizedUrl, status });
    }

    if (relay.status >= NDK_RELAY_STATUS_CONNECTED) {
      connected++;
    }
  }

  // Sort discovered relays alphabetically
  discoveredRelays.sort((a, b) => a.url.localeCompare(b.url));

  nostrStore.setConnectedRelays(connected);
  nostrStore.setRelayStatuses(statuses);
  nostrStore.setDiscoveredRelays(discoveredRelays);
}

// Listen for relay connect/disconnect events
ndk.pool?.on('relay:connect', () => updateConnectedRelayCount());
ndk.pool?.on('relay:disconnect', () => updateConnectedRelayCount());

// Also poll periodically in case events are missed
setInterval(updateConnectedRelayCount, 2000);

// Initial counts - check quickly then again after connection settles
setTimeout(updateConnectedRelayCount, 500);
setTimeout(updateConnectedRelayCount, 1500);
setTimeout(updateConnectedRelayCount, 3000);

// Update NDK relays when settings are loaded or relay list changes
// Only trigger on relay changes, not blossom server changes
let prevNetworkSettings = settingsStore.getState().network;
let prevRelaysJson = JSON.stringify(prevNetworkSettings?.relays);
settingsStore.subscribe((state) => {
  // Quick object reference check first (cheap)
  if (state.networkLoaded && state.network !== prevNetworkSettings) {
    // Network object changed - check if relays specifically changed
    const newRelaysJson = JSON.stringify(state.network?.relays);
    const relaysChanged = newRelaysJson !== prevRelaysJson;

    prevNetworkSettings = state.network;
    prevRelaysJson = newRelaysJson;

    // Only update NDK relays if the relay list actually changed
    if (relaysChanged) {
      updateNdkRelays().catch(console.error);
    }
  }
});

// Restore session after module initialization completes
// Using queueMicrotask to avoid circular import issues with store.ts
// This ensures WebRTCStore is ready when components start fetching
queueMicrotask(() => {
  restoreSession().catch(console.error);
});

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

/**
 * Create gift wrap and unwrap functions for NIP-17 style ephemeral message wrapping.
 * Used for private WebRTC signaling.
 *
 * Gift wrap creates a kind 25050 event signed by an ephemeral key, with the inner
 * event encrypted for the recipient. The inner event includes the actual sender's pubkey.
 *
 * @param myPubkey - The sender's actual pubkey (included inside the encrypted content)
 * @param encryptFn - Function to encrypt content for a recipient (NIP-44)
 * @param decryptFn - Function to decrypt content from a sender (NIP-44)
 */
function createGiftWrapFunctions(
  myPubkey: string,
  encryptFn: (pubkey: string, plaintext: string) => Promise<string>,
  decryptFn: (pubkey: string, ciphertext: string) => Promise<string>,
): { giftWrap: GiftWrapper; giftUnwrap: GiftUnwrapper } {
  const giftWrap: GiftWrapper = async (innerEvent, recipientPubkey) => {
    // Create seal with sender's actual pubkey (this is the "rumor")
    const seal = {
      pubkey: myPubkey,
      kind: innerEvent.kind,
      content: innerEvent.content,
      tags: innerEvent.tags,
    };

    // Generate ephemeral keypair for the wrapper
    const ephemeralSk = generateSecretKey();

    // Encrypt the seal for the recipient using ephemeral key (NIP-44)
    const conversationKey = nip44.v2.utils.getConversationKey(ephemeralSk, recipientPubkey);
    const encryptedContent = nip44.v2.encrypt(JSON.stringify(seal), conversationKey);

    // Create and sign wrapper event with ephemeral key
    const createdAt = Math.floor(Date.now() / 1000);
    const expiration = createdAt + 5 * 60; // 5 minutes

    // Use nostr-tools finalizeEvent to compute id and sign with ephemeral key
    return finalizeEvent({
      kind: 25050,
      created_at: createdAt,
      tags: [
        ['p', recipientPubkey],
        ['expiration', expiration.toString()],
      ],
      content: encryptedContent,
    }, ephemeralSk);
  };

  const giftUnwrap: GiftUnwrapper = async (event) => {
    try {
      // Decrypt using our key and the ephemeral sender's pubkey
      const decrypted = await decryptFn(event.pubkey, event.content);
      const seal = JSON.parse(decrypted) as {
        pubkey: string;
        kind: number;
        content: string;
        tags: string[][];
      };
      return seal;
    } catch {
      // Can't decrypt - not for us or invalid
      return null;
    }
  };

  return { giftWrap, giftUnwrap };
}

/**
 * Try to restore session from localStorage, or generate a new key if none exists
 */
export async function restoreSession(): Promise<boolean> {
  // Initialize accounts store first
  initAccountsStore();

  // Migrate legacy single account to multi-account storage if needed
  const legacyLoginType = localStorage.getItem(STORAGE_KEY_LOGIN_TYPE);
  const legacyNsec = localStorage.getItem(STORAGE_KEY_NSEC);
  const accountsState = accountsStore.getState();

  if (accountsState.accounts.length === 0 && (legacyLoginType || legacyNsec)) {
    // Migrate existing login to accounts store
    if (legacyLoginType === 'nsec' && legacyNsec) {
      const account = createAccountFromNsec(legacyNsec);
      if (account) {
        accountsStore.addAccount(account);
        accountsStore.setActiveAccount(account.pubkey);
        saveActiveAccountToStorage(account.pubkey);
      }
    }
    // Extension accounts are added when they successfully log in
  }

  // Use accounts store to restore session (not legacy storage)
  const activeAccount = accountsState.accounts.find(
    a => a.pubkey === accountsState.activeAccountPubkey
  );

  if (activeAccount) {
    if (activeAccount.type === 'extension') {
      return loginWithExtension();
    } else if (activeAccount.type === 'nsec' && activeAccount.nsec) {
      return loginWithNsec(activeAccount.nsec, false);
    }
  }

  // Fallback to legacy storage if no active account in store
  if (legacyLoginType === 'extension') {
    return loginWithExtension();
  } else if (legacyLoginType === 'nsec' && legacyNsec) {
    return loginWithNsec(legacyNsec);
  }

  // No existing session - auto-generate a new key
  generateNewKey();
  return true;
}

/**
 * Wait for window.nostr to be available (extensions inject asynchronously)
 */
async function waitForNostrExtension(timeoutMs = 2000): Promise<boolean> {
  if (window.nostr) return true;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.nostr) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Login with NIP-07 browser extension (window.nostr)
 */
export async function loginWithExtension(): Promise<boolean> {
  try {
    // Wait for extension to be injected (may take a moment on page load)
    const extensionAvailable = await waitForNostrExtension();
    if (!extensionAvailable) {
      throw new Error('No nostr extension found');
    }

    const signer = new NDKNip07Signer();
    ndk.signer = signer;

    const user = await signer.user();
    const pk = user.pubkey;

    nostrStore.setPubkey(pk);
    nostrStore.setNpub(nip19.npubEncode(pk));
    nostrStore.setIsLoggedIn(true);
    secretKey = null;

    // Save login type (extension handles its own key storage)
    localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'extension');
    localStorage.removeItem(STORAGE_KEY_NSEC);

    // Add to accounts store if not already present
    const accountsState = accountsStore.getState();
    if (!accountsState.accounts.some(a => a.pubkey === pk)) {
      const account = createExtensionAccount(pk);
      accountsStore.addAccount(account);
    }
    accountsStore.setActiveAccount(pk);
    saveActiveAccountToStorage(pk);

    // Use window.nostr.nip44 for encryption (NIP-07 compatible)
    // Fall back to nip04 if nip44 is not available
    const encrypt = async (pubkey: string, plaintext: string) => {
      if (window.nostr!.nip44?.encrypt) {
        return window.nostr!.nip44!.encrypt(pubkey, plaintext);
      }
      return window.nostr!.nip04!.encrypt(pubkey, plaintext);
    };
    const decrypt = async (pubkey: string, ciphertext: string) => {
      if (window.nostr!.nip44?.decrypt) {
        return window.nostr!.nip44!.decrypt(pubkey, ciphertext);
      }
      return window.nostr!.nip04!.decrypt(pubkey, ciphertext);
    };

    // Create gift wrap functions for private WebRTC signaling
    const { giftWrap, giftUnwrap } = createGiftWrapFunctions(pk, encrypt, decrypt);

    // Initialize WebRTC with signer
    initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt, giftWrap, giftUnwrap);

    // Start background sync for followed users' trees
    startBackgroundSync();

    return true;
  } catch (e) {
    console.error('Extension login failed:', e);
    return false;
  }
}

/**
 * Login with nsec
 */
export function loginWithNsec(nsec: string, save = true): boolean {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec');
    }

    secretKey = decoded.data as Uint8Array;
    const pk = getPublicKey(secretKey);

    // Set NDK signer
    const signer = new NDKPrivateKeySigner(nsec);
    ndk.signer = signer;

    nostrStore.setPubkey(pk);
    nostrStore.setNpub(nip19.npubEncode(pk));
    nostrStore.setIsLoggedIn(true);

    // Save to localStorage
    if (save) {
      localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'nsec');
      localStorage.setItem(STORAGE_KEY_NSEC, nsec);

      // Add to accounts store if not already present
      const accountsState = accountsStore.getState();
      if (!accountsState.accounts.some(a => a.pubkey === pk)) {
        const account = createAccountFromNsec(nsec);
        if (account) {
          accountsStore.addAccount(account);
        }
      }
      accountsStore.setActiveAccount(pk);
      saveActiveAccountToStorage(pk);
    }

    // Create encrypt/decrypt using nostr-tools nip44
    const sk = secretKey;
    const encrypt = async (pubkey: string, plaintext: string) => {
      const conversationKey = nip44.v2.utils.getConversationKey(sk, pubkey);
      return nip44.v2.encrypt(plaintext, conversationKey);
    };
    const decrypt = async (pubkey: string, ciphertext: string) => {
      const conversationKey = nip44.v2.utils.getConversationKey(sk, pubkey);
      return nip44.v2.decrypt(ciphertext, conversationKey);
    };

    // Create gift wrap functions for private WebRTC signaling
    const { giftWrap, giftUnwrap } = createGiftWrapFunctions(pk, encrypt, decrypt);

    // Initialize WebRTC with signer
    initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt, giftWrap, giftUnwrap);

    // Start background sync for followed users' trees
    startBackgroundSync();

    return true;
  } catch (e) {
    console.error('Nsec login failed:', e);
    return false;
  }
}

/**
 * Generate new keypair
 */
export function generateNewKey(): { nsec: string; npub: string } {
  secretKey = generateSecretKey();
  const pk = getPublicKey(secretKey);
  const nsec = nip19.nsecEncode(secretKey);

  // Set NDK signer
  const signer = new NDKPrivateKeySigner(nsec);
  ndk.signer = signer;

  nostrStore.setPubkey(pk);
  const npubStr = nip19.npubEncode(pk);
  nostrStore.setNpub(npubStr);
  nostrStore.setIsLoggedIn(true);

  // Save to localStorage
  localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'nsec');
  localStorage.setItem(STORAGE_KEY_NSEC, nsec);

  // Add to accounts store
  const account = createAccountFromNsec(nsec);
  if (account) {
    accountsStore.addAccount(account);
    accountsStore.setActiveAccount(pk);
    saveActiveAccountToStorage(pk);
  }

  // Create encrypt/decrypt using nostr-tools nip44
  const sk = secretKey;
  const encrypt = async (pubkey: string, plaintext: string) => {
    const conversationKey = nip44.v2.utils.getConversationKey(sk, pubkey);
    return nip44.v2.encrypt(plaintext, conversationKey);
  };
  const decrypt = async (pubkey: string, ciphertext: string) => {
    const conversationKey = nip44.v2.utils.getConversationKey(sk, pubkey);
    return nip44.v2.decrypt(ciphertext, conversationKey);
  };

  // Create gift wrap functions for private WebRTC signaling
  const { giftWrap, giftUnwrap } = createGiftWrapFunctions(pk, encrypt, decrypt);

  // Initialize WebRTC with signer
  initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt, giftWrap, giftUnwrap);

  // Create default folders for new user (public, link, private)
  // Do this BEFORE starting background sync so folders exist
  createDefaultFolders();

  // Start background sync for followed users' trees (delayed to not block init)
  setTimeout(() => startBackgroundSync(), 1000);

  return { nsec, npub: npubStr };
}

/**
 * Create default folders for a new user
 */
async function createDefaultFolders() {
  try {
    const { createTree } = await import('./actions');
    // Create folders in sequence with skipNavigation=true
    await createTree('public', 'public', true);
    await createTree('link', 'unlisted', true);
    await createTree('private', 'private', true);
  } catch (e) {
    console.error('Failed to create default folders:', e);
  }
}

/**
 * Logout
 */
export function logout() {
  nostrStore.setPubkey(null);
  nostrStore.setNpub(null);
  nostrStore.setIsLoggedIn(false);
  nostrStore.setSelectedTree(null);
  secretKey = null;
  ndk.signer = undefined;

  // Stop background sync
  stopBackgroundSync();

  // Stop WebRTC
  stopWebRTC();

  // Clear localStorage
  localStorage.removeItem(STORAGE_KEY_LOGIN_TYPE);
  localStorage.removeItem(STORAGE_KEY_NSEC);
}

// Re-export visibility hex helpers from hashtree lib
export { visibilityHex as linkKeyUtils } from 'hashtree';

/**
 * Parse visibility from Nostr event tags
 */
export function parseVisibility(tags: string[][]): { visibility: TreeVisibility; rootKey?: string; encryptedKey?: string; keyId?: string; selfEncryptedKey?: string } {
  const rootKey = tags.find(t => t[0] === 'key')?.[1];
  const encryptedKey = tags.find(t => t[0] === 'encryptedKey')?.[1];
  const keyId = tags.find(t => t[0] === 'keyId')?.[1];
  const selfEncryptedKey = tags.find(t => t[0] === 'selfEncryptedKey')?.[1];

  let visibility: TreeVisibility;
  if (selfEncryptedKey) {
    visibility = 'private';
  } else if (encryptedKey) {
    visibility = 'unlisted';
  } else {
    visibility = 'public';
  }

  return { visibility, rootKey, encryptedKey, keyId, selfEncryptedKey };
}

export interface SaveHashtreeOptions {
  visibility?: TreeVisibility;
  /** Link key for unlisted trees - if not provided, one will be generated */
  linkKey?: string;
  /** Additional l-tags to add (e.g., ['docs'] for document trees) */
  labels?: string[];
}

/**
 * Save/publish hashtree to relays
 * @param name - Tree name
 * @param rootHash - Root hash (hex encoded)
 * @param rootKey - Decryption key (hex encoded, optional for encrypted trees)
 * @param options - Visibility options
 * @returns Object with success status and linkKey (for unlisted trees)
 */
export async function saveHashtree(
  name: string,
  rootHash: string,
  rootKey?: string,
  options: SaveHashtreeOptions = {}
): Promise<{ success: boolean; linkKey?: string }> {
  const state = nostrStore.getState();
  if (!state.pubkey || !ndk.signer) return { success: false };

  const visibility = options.visibility ?? 'public';

  // Set created_at now (before any async work) so all events from this save have same timestamp
  // This prevents async-published events from having later timestamps that override local cache
  const now = Math.floor(Date.now() / 1000);

  const event = new NDKEvent(ndk);
  event.kind = 30078;
  event.content = '';
  event.created_at = now;
  event.tags = [
    ['d', name],
    ['l', 'hashtree'],
    ['hash', rootHash],
  ];

  // Add extra labels if provided
  if (options.labels) {
    for (const label of options.labels) {
      event.tags.push(['l', label]);
    }
  }

  let linkKey: string | undefined;

  if (rootKey) {
    switch (visibility) {
      case 'public':
        // Plaintext key - anyone can access
        event.tags.push(['key', rootKey]);
        break;

      case 'unlisted':
        // Encrypt key with link key for sharing - do async work in background
        linkKey = options.linkKey ?? visibilityHex.generateLinkKey();
        // Fire off encryption and publish in background
        (async () => {
          const encryptedKey = await visibilityHex.encryptKeyForLink(rootKey, linkKey!);
          const keyId = await visibilityHex.computeKeyId(linkKey!);
          event.tags.push(['encryptedKey', encryptedKey]);
          event.tags.push(['keyId', keyId]);
          // Also self-encrypt so owner can always access without link key
          const conversationKey = nip44.v2.utils.getConversationKey(secretKey!, state.pubkey!);
          const selfEncryptedUnlisted = nip44.v2.encrypt(rootKey, conversationKey);
          event.tags.push(['selfEncryptedKey', selfEncryptedUnlisted]);
          // Sign first, then cache locally for offline-first
          try {
            await event.sign();
            if (ndk.cacheAdapter?.setEvent) {
              await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey!], '#d': [name] }]);
            }
          } catch (e) {
            console.error('Failed to sign/cache hashtree:', e);
          }
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;

      case 'private':
        // Encrypt key to self using NIP-44 - do async work in background
        (async () => {
          const conversationKey = nip44.v2.utils.getConversationKey(secretKey!, state.pubkey!);
          const selfEncrypted = nip44.v2.encrypt(rootKey, conversationKey);
          event.tags.push(['selfEncryptedKey', selfEncrypted]);
          // Sign first, then cache locally for offline-first
          try {
            await event.sign();
            if (ndk.cacheAdapter?.setEvent) {
              await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey!], '#d': [name] }]);
            }
          } catch (e) {
            console.error('Failed to sign/cache hashtree:', e);
          }
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;
    }
  }

  // For public visibility, publish immediately (no encryption needed)
  if (!rootKey || visibility === 'public') {
    // Sign first, then cache locally for offline-first behavior
    (async () => {
      try {
        await event.sign();
        // Cache locally FIRST for offline-first behavior (survives page refresh)
        if (ndk.cacheAdapter?.setEvent) {
          await ndk.cacheAdapter.setEvent(event, [{ kinds: [30078], authors: [state.pubkey], '#d': [name] }]);
        }
        event.publish().catch(e => console.error('Failed to publish hashtree:', e));
      } catch (e) {
        console.error('Failed to sign/cache hashtree:', e);
      }
    })();
  }

  // Update selectedTree if it matches
  const currentSelected = state.selectedTree;
  if (currentSelected && currentSelected.name === name && currentSelected.pubkey === state.pubkey) {
    nostrStore.setSelectedTree({
      ...currentSelected,
      rootHash,
      rootKey: visibility === 'public' ? rootKey : undefined,
      visibility,
      created_at: event.created_at || Math.floor(Date.now() / 1000),
    });
  }

  // Update local cache SYNCHRONOUSLY for instant UI (tree appears immediately in list)
  // This must happen before navigation so the new tree list subscription sees the cached entry
  // skipNostrPublish=true because we handle Nostr publishing above with proper visibility tags
  const npub = state.npub;
  if (npub) {
    const { getRefResolver } = await import('./refResolver');
    const { fromHex, cid } = await import('hashtree');
    const resolver = getRefResolver();
    const hash = fromHex(rootHash);
    // Include the encryption key for ALL visibility levels when owner is saving
    // This allows immediate access without waiting for selfEncryptedKey decryption
    const encryptionKey = rootKey ? fromHex(rootKey) : undefined;
    // This synchronously updates the resolver's localListCache (skips Nostr publish)
    resolver.publish?.(`${npub}/${name}`, cid(hash, encryptionKey), { visibility }, true);

    // Also update treeRootCache for SW file handler access
    // This is critical for immediate video playback after upload
    updateLocalRootCacheHex(npub, name, rootHash, rootKey, visibility);
  }

  return { success: true, linkKey };
}

/**
 * Get npub from pubkey
 */
export function pubkeyToNpub(pk: string): string {
  return nip19.npubEncode(pk);
}

/**
 * Get pubkey from npub
 */
export function npubToPubkey(npubStr: string): string | null {
  try {
    const decoded = nip19.decode(npubStr);
    if (decoded.type !== 'npub') return null;
    return decoded.data as string;
  } catch {
    return null;
  }
}

/**
 * Check if the selected tree belongs to the logged-in user
 */
export function isOwnTree(): boolean {
  const state = nostrStore.getState();
  if (!state.isLoggedIn || !state.selectedTree || !state.pubkey) return false;
  return state.selectedTree.pubkey === state.pubkey;
}

/**
 * Autosave current tree if it's our own.
 * Updates local cache immediately, publishing is throttled.
 * @param rootCid - Root CID (contains hash and optional encryption key)
 */
export function autosaveIfOwn(rootCid: CID): void {
  const state = nostrStore.getState();
  if (!isOwnTree() || !state.selectedTree || !state.npub) {
    return;
  }

  const rootHash = toHex(rootCid.hash);
  const rootKey = rootCid.key ? toHex(rootCid.key) : undefined;

  // Update local cache - this triggers throttled publish to Nostr
  updateLocalRootCacheHex(state.npub, state.selectedTree.name, rootHash, rootKey);

  // Update selectedTree state immediately for UI
  nostrStore.setSelectedTree({
    ...state.selectedTree,
    rootHash,
    rootKey: state.selectedTree.visibility === 'public' ? rootKey : state.selectedTree.rootKey,
  });
}

/**
 * Publish tree root to Nostr (called by treeRootCache after throttle)
 * This is the ONLY place that should publish merkle roots.
 *
 * @param cachedVisibility - Visibility from the root cache. Use this first, then fall back to selectedTree.
 */
export async function publishTreeRoot(treeName: string, rootHash: string, rootKey?: string, cachedVisibility?: TreeVisibility): Promise<boolean> {
  const state = nostrStore.getState();
  if (!state.pubkey || !ndk.signer) return false;

  // Priority: cached visibility > selectedTree visibility > 'public'
  let visibility: TreeVisibility = cachedVisibility ?? 'public';
  let linkKey: string | undefined;

  // If no cached visibility, try to get from selectedTree
  if (!cachedVisibility) {
    const isOwnSelectedTree = state.selectedTree?.name === treeName &&
      state.selectedTree?.pubkey === state.pubkey;
    if (isOwnSelectedTree && state.selectedTree?.visibility) {
      visibility = state.selectedTree.visibility;
    }
  }

  // For unlisted trees, get the linkKey from the URL
  if (visibility === 'unlisted') {
    const route = parseRoute();
    linkKey = route.linkKey ?? undefined;
  }

  const result = await saveHashtree(treeName, rootHash, rootKey, {
    visibility,
    linkKey,
  });

  return result.success;
}

/**
 * Delete a tree (publishes event without hash to nullify)
 * Tree will disappear from listings but can be re-created with same name
 */
export async function deleteTree(treeName: string): Promise<boolean> {
  const state = nostrStore.getState();
  if (!state.npub) return false;

  // Cancel any pending throttled publish - this is critical!
  // Without this, the throttled publish timer could fire after the delete
  // and republish the tree with hash, effectively "undeleting" it
  const { cancelPendingPublish } = await import('./treeRootCache');
  cancelPendingPublish(state.npub, treeName);

  // Remove from recents store
  const { removeRecentByTreeName } = await import('./stores/recents');
  removeRecentByTreeName(state.npub, treeName);

  const { getRefResolver } = await import('./refResolver');
  const resolver = getRefResolver();

  const key = `${state.npub}/${treeName}`;
  return resolver.delete?.(key) ?? false;
}
