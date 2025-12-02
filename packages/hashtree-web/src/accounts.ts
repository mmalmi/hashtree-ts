/**
 * Multi-account management for HashTree Explorer
 * Stores multiple accounts and allows switching between them
 */
import { create } from 'zustand';
import { nip19, getPublicKey } from 'nostr-tools';

// Storage key for accounts list
const STORAGE_KEY_ACCOUNTS = 'hashtree:accounts';
const STORAGE_KEY_ACTIVE_ACCOUNT = 'hashtree:activeAccount';

export type AccountType = 'nsec' | 'extension';

export interface Account {
  pubkey: string;
  npub: string;
  type: AccountType;
  nsec?: string; // Only for nsec accounts
  addedAt: number;
}

interface AccountsState {
  accounts: Account[];
  activeAccountPubkey: string | null;

  // Actions
  setAccounts: (accounts: Account[]) => void;
  setActiveAccount: (pubkey: string | null) => void;
  addAccount: (account: Account) => void;
  removeAccount: (pubkey: string) => boolean; // Returns false if trying to remove last account
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  activeAccountPubkey: null,

  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (pubkey) => set({ activeAccountPubkey: pubkey }),

  addAccount: (account) => {
    const { accounts } = get();
    // Don't add duplicates
    if (accounts.some(a => a.pubkey === account.pubkey)) {
      return;
    }
    const newAccounts = [...accounts, account];
    set({ accounts: newAccounts });
    saveAccountsToStorage(newAccounts);
  },

  removeAccount: (pubkey) => {
    const { accounts, activeAccountPubkey } = get();
    // Don't allow removing the last account
    if (accounts.length <= 1) {
      return false;
    }
    const newAccounts = accounts.filter(a => a.pubkey !== pubkey);
    set({ accounts: newAccounts });
    saveAccountsToStorage(newAccounts);

    // If removing active account, switch to another
    if (activeAccountPubkey === pubkey && newAccounts.length > 0) {
      set({ activeAccountPubkey: newAccounts[0].pubkey });
      localStorage.setItem(STORAGE_KEY_ACTIVE_ACCOUNT, newAccounts[0].pubkey);
    }
    return true;
  },
}));

/**
 * Save accounts to localStorage (nsec stored for nsec accounts)
 */
function saveAccountsToStorage(accounts: Account[]) {
  const data = accounts.map(a => ({
    pubkey: a.pubkey,
    npub: a.npub,
    type: a.type,
    nsec: a.nsec,
    addedAt: a.addedAt,
  }));
  localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(data));
}

/**
 * Load accounts from localStorage
 */
export function loadAccountsFromStorage(): Account[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    if (!data) return [];
    return JSON.parse(data) as Account[];
  } catch {
    return [];
  }
}

/**
 * Get active account pubkey from localStorage
 */
export function getActiveAccountFromStorage(): string | null {
  return localStorage.getItem(STORAGE_KEY_ACTIVE_ACCOUNT);
}

/**
 * Save active account to localStorage
 */
export function saveActiveAccountToStorage(pubkey: string | null) {
  if (pubkey) {
    localStorage.setItem(STORAGE_KEY_ACTIVE_ACCOUNT, pubkey);
  } else {
    localStorage.removeItem(STORAGE_KEY_ACTIVE_ACCOUNT);
  }
}

/**
 * Create account from nsec
 */
export function createAccountFromNsec(nsec: string): Account | null {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') return null;
    const secretKey = decoded.data as Uint8Array;
    const pubkey = getPublicKey(secretKey);
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
      type: 'nsec',
      nsec,
      addedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Create account for extension (pubkey already known)
 */
export function createExtensionAccount(pubkey: string): Account {
  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    type: 'extension',
    addedAt: Date.now(),
  };
}

/**
 * Check if extension account already exists
 */
export function hasExtensionAccount(): boolean {
  const accounts = useAccountsStore.getState().accounts;
  return accounts.some(a => a.type === 'extension');
}

/**
 * Check if window.nostr is available
 */
export function hasNostrExtension(): boolean {
  return typeof window !== 'undefined' && !!window.nostr;
}

/**
 * Initialize accounts store from localStorage
 */
export function initAccountsStore() {
  const accounts = loadAccountsFromStorage();
  const activeAccountPubkey = getActiveAccountFromStorage();

  useAccountsStore.setState({
    accounts,
    activeAccountPubkey: activeAccountPubkey && accounts.some(a => a.pubkey === activeAccountPubkey)
      ? activeAccountPubkey
      : accounts.length > 0 ? accounts[0].pubkey : null,
  });
}
