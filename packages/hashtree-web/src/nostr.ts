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
} from 'nostr-tools';
import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKNip07Signer,
  type NostrEvent,
} from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { initWebRTC, stopWebRTC } from './store';
import type { EventSigner } from 'hashtree';
import {
  type TreeVisibility,
  visibilityHex,
} from 'hashtree';
import { updateLocalRootCacheHex } from './treeRootCache';
import {
  accountsStore,
  initAccountsStore,
  createAccountFromNsec,
  createExtensionAccount,
  saveActiveAccountToStorage,
} from './accounts';
import { parseRoute } from './utils/route';

// Default relays
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://temp.iris.to',
  'wss://relay.snort.social',
];

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

// Nostr state interface
interface NostrState {
  pubkey: string | null;
  npub: string | null;
  isLoggedIn: boolean;
  selectedTree: HashTreeEvent | null;
  relays: string[];
}

// Create Svelte store for nostr state
function createNostrStore() {
  const { subscribe, set, update } = writable<NostrState>({
    pubkey: null,
    npub: null,
    isLoggedIn: false,
    selectedTree: null,
    relays: DEFAULT_RELAYS,
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

    // Get current state synchronously
    getState: (): NostrState => get(nostrStore),

    // Set state directly
    setState: (newState: Partial<NostrState>) => {
      update(state => ({ ...state, ...newState }));
    },
  };
}

export const nostrStore = createNostrStore();

// Legacy compatibility alias
export const useNostrStore = nostrStore;

// Expose for debugging in tests
if (typeof window !== 'undefined') {
  (window as Window & { __nostrStore?: typeof nostrStore }).__nostrStore = nostrStore;
}

// Private key (only set for nsec login)
let secretKey: Uint8Array | null = null;

/**
 * Get the secret key for decryption (only available for nsec login)
 * Returns null for extension logins
 */
export function getSecretKey(): Uint8Array | null {
  return secretKey;
}

// NDK instance with Dexie cache
const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'hashtree-ndk-cache' });

export const ndk = new NDK({
  explicitRelayUrls: DEFAULT_RELAYS,
  // @ts-expect-error - NDK cache adapter version mismatch
  cacheAdapter,
});

// Connect on init
ndk.connect().catch(console.error);

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

    // Initialize WebRTC with signer
    initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt);

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

    // Initialize WebRTC with signer
    initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt);

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

  // Initialize WebRTC with signer
  initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt);

  // Create default folders for new user (public, link, private)
  createDefaultFolders();

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

  const event = new NDKEvent(ndk);
  event.kind = 30078;
  event.content = '';
  event.tags = [
    ['d', name],
    ['l', 'hashtree'],
    ['hash', rootHash],
  ];

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
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;

      case 'private':
        // Encrypt key to self using NIP-44 - do async work in background
        (async () => {
          const conversationKey = nip44.v2.utils.getConversationKey(secretKey!, state.pubkey!);
          const selfEncrypted = nip44.v2.encrypt(rootKey, conversationKey);
          event.tags.push(['selfEncryptedKey', selfEncrypted]);
          event.publish().catch(e => console.error('Failed to publish hashtree:', e));
        })();
        break;
    }
  }

  // For public visibility, publish immediately (no encryption needed)
  if (!rootKey || visibility === 'public') {
    event.publish().catch(e => console.error('Failed to publish hashtree:', e));
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
 * @param rootHash - Root hash (hex encoded)
 * @param rootKey - Decryption key (hex encoded, optional for encrypted trees)
 */
export function autosaveIfOwn(rootHash: string, rootKey?: string): void {
  const state = nostrStore.getState();
  if (!isOwnTree() || !state.selectedTree || !state.npub) return;

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
 */
export async function publishTreeRoot(treeName: string, rootHash: string, rootKey?: string): Promise<boolean> {
  const state = nostrStore.getState();
  if (!state.pubkey || !ndk.signer || !state.selectedTree) return false;

  // Only publish if this is for the current tree
  if (state.selectedTree.name !== treeName) return false;

  const visibility = state.selectedTree.visibility;

  // For unlisted trees, get the linkKey from the URL
  let linkKey: string | undefined;
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
