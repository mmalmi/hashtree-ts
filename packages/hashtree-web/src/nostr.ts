/**
 * Nostr integration for HashTree Explorer
 * Uses NDK with Dexie cache for IndexedDB persistence
 */
import { create } from 'zustand';
import {
  generateSecretKey,
  getPublicKey,
  nip19,
  nip04,
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
import {
  useAccountsStore,
  initAccountsStore,
  createAccountFromNsec,
  createExtensionAccount,
  saveActiveAccountToStorage,
  loadAccountsFromStorage,
} from './accounts';
import { parseRoute } from './utils/route';

// Using global Window.nostr interface from NDK types

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

// Nostr state store
interface NostrState {
  pubkey: string | null;
  npub: string | null;
  isLoggedIn: boolean;
  /** True when user was just auto-generated (first visit) - cleared after redirect */
  isNewUser: boolean;
  selectedTree: HashTreeEvent | null;
  relays: string[];

  setPubkey: (pk: string | null) => void;
  setNpub: (npub: string | null) => void;
  setIsLoggedIn: (loggedIn: boolean) => void;
  setIsNewUser: (isNew: boolean) => void;
  setSelectedTree: (tree: HashTreeEvent | null) => void;
  setRelays: (relays: string[]) => void;
}

export const useNostrStore = create<NostrState>((set) => ({
  pubkey: null,
  npub: null,
  isLoggedIn: false,
  isNewUser: false,
  selectedTree: null,
  relays: DEFAULT_RELAYS,

  setPubkey: (pk) => set({ pubkey: pk }),
  setNpub: (npub) => set({ npub }),
  setIsLoggedIn: (loggedIn) => set({ isLoggedIn: loggedIn }),
  setIsNewUser: (isNew) => set({ isNewUser: isNew }),
  setSelectedTree: (tree) => set({ selectedTree: tree }),
  setRelays: (relays) => set({ relays }),
}));

// Expose for debugging in tests
if (typeof window !== 'undefined') {
  (window as any).__nostrStore = useNostrStore;
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

// Restore session immediately at module load (before React renders)
// This ensures WebRTCStore is ready when components start fetching
restoreSession().catch(console.error);

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
  const accountsState = useAccountsStore.getState();

  if (accountsState.accounts.length === 0 && (legacyLoginType || legacyNsec)) {
    // Migrate existing login to accounts store
    if (legacyLoginType === 'nsec' && legacyNsec) {
      const account = createAccountFromNsec(legacyNsec);
      if (account) {
        accountsState.addAccount(account);
        accountsState.setActiveAccount(account.pubkey);
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
  const store = useNostrStore.getState();
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

    store.setPubkey(pk);
    store.setNpub(nip19.npubEncode(pk));
    store.setIsLoggedIn(true);
    secretKey = null;

    // Save login type (extension handles its own key storage)
    localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'extension');
    localStorage.removeItem(STORAGE_KEY_NSEC);

    // Add to accounts store if not already present
    const accountsStore = useAccountsStore.getState();
    if (!accountsStore.accounts.some(a => a.pubkey === pk)) {
      const account = createExtensionAccount(pk);
      accountsStore.addAccount(account);
    }
    accountsStore.setActiveAccount(pk);
    saveActiveAccountToStorage(pk);

    // Use window.nostr.nip04 for encryption (NIP-07 compatible)
    const encrypt = async (pubkey: string, plaintext: string) => {
      return window.nostr!.nip04!.encrypt(pubkey, plaintext);
    };
    const decrypt = async (pubkey: string, ciphertext: string) => {
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
  const store = useNostrStore.getState();
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

    store.setPubkey(pk);
    store.setNpub(nip19.npubEncode(pk));
    store.setIsLoggedIn(true);

    // Save to localStorage
    if (save) {
      localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'nsec');
      localStorage.setItem(STORAGE_KEY_NSEC, nsec);

      // Add to accounts store if not already present
      const accountsStore = useAccountsStore.getState();
      if (!accountsStore.accounts.some(a => a.pubkey === pk)) {
        const account = createAccountFromNsec(nsec);
        if (account) {
          accountsStore.addAccount(account);
        }
      }
      accountsStore.setActiveAccount(pk);
      saveActiveAccountToStorage(pk);
    }

    // Create encrypt/decrypt using nostr-tools nip04
    const sk = secretKey;
    const encrypt = async (pubkey: string, plaintext: string) => {
      return nip04.encrypt(sk, pubkey, plaintext);
    };
    const decrypt = async (pubkey: string, ciphertext: string) => {
      return nip04.decrypt(sk, pubkey, ciphertext);
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
  const store = useNostrStore.getState();
  secretKey = generateSecretKey();
  const pk = getPublicKey(secretKey);
  const nsec = nip19.nsecEncode(secretKey);

  // Set NDK signer
  const signer = new NDKPrivateKeySigner(nsec);
  ndk.signer = signer;

  store.setPubkey(pk);
  const npubStr = nip19.npubEncode(pk);
  store.setNpub(npubStr);
  store.setIsLoggedIn(true);
  store.setIsNewUser(true); // Mark for home redirect

  // Save to localStorage
  localStorage.setItem(STORAGE_KEY_LOGIN_TYPE, 'nsec');
  localStorage.setItem(STORAGE_KEY_NSEC, nsec);

  // Add to accounts store
  const accountsStore = useAccountsStore.getState();
  const account = createAccountFromNsec(nsec);
  if (account) {
    accountsStore.addAccount(account);
    accountsStore.setActiveAccount(pk);
    saveActiveAccountToStorage(pk);
  }

  // Create encrypt/decrypt using nostr-tools nip04
  const sk = secretKey;
  const encrypt = async (pubkey: string, plaintext: string) => {
    return nip04.encrypt(sk, pubkey, plaintext);
  };
  const decrypt = async (pubkey: string, ciphertext: string) => {
    return nip04.decrypt(sk, pubkey, ciphertext);
  };

  // Initialize WebRTC with signer
  initWebRTC(signEvent as EventSigner, pk, encrypt, decrypt);

  return { nsec, npub: npubStr };
}

/**
 * Logout
 */
export function logout() {
  const store = useNostrStore.getState();
  store.setPubkey(null);
  store.setNpub(null);
  store.setIsLoggedIn(false);
  store.setSelectedTree(null);
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
  const store = useNostrStore.getState();
  if (!store.pubkey || !ndk.signer) return { success: false };

  const visibility = options.visibility ?? 'public';

  try {
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
          // Encrypt key with link key for sharing
          linkKey = options.linkKey ?? visibilityHex.generateLinkKey();
          const encryptedKey = await visibilityHex.encryptKeyForLink(rootKey, linkKey);
          const keyId = await visibilityHex.computeKeyId(linkKey);
          event.tags.push(['encryptedKey', encryptedKey]);
          event.tags.push(['keyId', keyId]);
          // Also self-encrypt so owner can always access without link key
          const selfEncryptedUnlisted = await nip04.encrypt(secretKey!, store.pubkey, rootKey);
          event.tags.push(['selfEncryptedKey', selfEncryptedUnlisted]);
          break;

        case 'private':
          // Encrypt key to self using NIP-04
          const selfEncrypted = await nip04.encrypt(secretKey!, store.pubkey, rootKey);
          event.tags.push(['selfEncryptedKey', selfEncrypted]);
          break;
      }
    }

    await event.publish();

    // Update selectedTree if it matches
    const currentSelected = store.selectedTree;
    if (currentSelected && currentSelected.name === name && currentSelected.pubkey === store.pubkey) {
      useNostrStore.getState().setSelectedTree({
        ...currentSelected,
        rootHash,
        rootKey: visibility === 'public' ? rootKey : undefined,
        visibility,
        created_at: event.created_at || Math.floor(Date.now() / 1000),
      });
    }

    return { success: true, linkKey };
  } catch (e) {
    console.error('Failed to save hashtree:', e);
    return { success: false };
  }
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
  const store = useNostrStore.getState();
  if (!store.isLoggedIn || !store.selectedTree || !store.pubkey) return false;
  return store.selectedTree.pubkey === store.pubkey;
}

/**
 * Autosave current tree if it's our own
 * Preserves the tree's visibility setting (public/unlisted/private)
 * @param rootHash - Root hash (hex encoded)
 * @param rootKey - Decryption key (hex encoded, optional for encrypted trees)
 */
export async function autosaveIfOwn(rootHash: string, rootKey?: string): Promise<boolean> {
  const store = useNostrStore.getState();
  if (!isOwnTree() || !store.selectedTree) return false;

  // Preserve the tree's visibility when autosaving
  const visibility = store.selectedTree.visibility;

  // For unlisted trees, get the linkKey from the URL
  let linkKey: string | undefined;
  if (visibility === 'unlisted') {
    const route = parseRoute();
    linkKey = route.linkKey ?? undefined;
  }

  const result = await saveHashtree(store.selectedTree.name, rootHash, rootKey, {
    visibility,
    linkKey,
  });
  return result.success;
}
