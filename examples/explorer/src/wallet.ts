/**
 * Cashu Wallet integration using coco-cashu
 */
import { create } from 'zustand';
import { IndexedDbRepositories } from 'coco-cashu-indexeddb';
import { Manager, ConsoleLogger, getDecodedToken, getEncodedToken } from 'coco-cashu-core';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// Storage keys
const STORAGE_KEY_MNEMONIC = 'hashtree:mnemonic';

// Default mint
const DEFAULT_MINT = 'https://mint.minibits.cash/Bitcoin';

// Wallet state store
interface WalletState {
  walletReady: boolean;
  balances: Record<string, number>;
  mints: string[];
  setWalletReady: (ready: boolean) => void;
  setBalances: (balances: Record<string, number>) => void;
  setMints: (mints: string[]) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  walletReady: false,
  balances: {},
  mints: [],
  setWalletReady: (ready) => set({ walletReady: ready }),
  setBalances: (balances) => set({ balances }),
  setMints: (mints) => set({ mints }),
}));

// Computed total balance helper
export function getTotalBalance(): number {
  const balances = useWalletStore.getState().balances;
  return Object.values(balances).reduce((sum, b) => sum + b, 0);
}

// Legacy exports for compatibility
export const walletReady = {
  get value() { return useWalletStore.getState().walletReady; },
  set value(v: boolean) { useWalletStore.getState().setWalletReady(v); },
};
export const balances = {
  get value() { return useWalletStore.getState().balances; },
  set value(v: Record<string, number>) { useWalletStore.getState().setBalances(v); },
};
export const totalBalance = {
  get value() { return getTotalBalance(); },
};
export const mints = {
  get value() { return useWalletStore.getState().mints; },
  set value(v: string[]) { useWalletStore.getState().setMints(v); },
};

// Manager instance
let manager: Manager | null = null;

/**
 * Initialize the wallet with stored or new mnemonic
 */
export async function initWallet(): Promise<void> {
  if (manager) return;

  let mnemonic = localStorage.getItem(STORAGE_KEY_MNEMONIC);
  if (!mnemonic) {
    mnemonic = bip39.generateMnemonic(wordlist);
    localStorage.setItem(STORAGE_KEY_MNEMONIC, mnemonic);
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);

  const repos = new IndexedDbRepositories({ name: 'hashtree-wallet' });
  await repos.init();

  const logger = new ConsoleLogger('wallet', { level: 'warn' });
  manager = new Manager(repos, async () => seed, logger);

  // Subscribe to balance changes
  manager.on('proofs:saved', async () => {
    await refreshBalances();
  });
  manager.on('proofs:deleted', async () => {
    await refreshBalances();
  });

  useWalletStore.getState().setWalletReady(true);
  await refreshBalances();
  await refreshMints();
}

/**
 * Refresh balances from all mints
 */
export async function refreshBalances(): Promise<void> {
  if (!manager) return;
  try {
    const newBalances = await manager.wallet.getBalances();
    useWalletStore.getState().setBalances(newBalances);
  } catch (e) {
    console.error('Failed to refresh balances:', e);
  }
}

/**
 * Refresh list of known mints
 */
export async function refreshMints(): Promise<void> {
  if (!manager) return;
  try {
    const allMints = await manager.mint.getAllMints();
    useWalletStore.getState().setMints(allMints.map(m => (m as unknown as { url: string }).url));
  } catch (e) {
    console.error('Failed to refresh mints:', e);
  }
}

/**
 * Add a new mint
 */
export async function addMint(mintUrl: string): Promise<boolean> {
  if (!manager) return false;
  try {
    await manager.mint.addMint(mintUrl);
    await refreshMints();
    return true;
  } catch (e) {
    console.error('Failed to add mint:', e);
    return false;
  }
}

/**
 * Create a mint quote (Lightning invoice to receive)
 */
export async function createMintQuote(mintUrl: string, amount: number): Promise<{ quote: string; request: string } | null> {
  if (!manager) return null;
  try {
    const quote = await manager.quotes.createMintQuote(mintUrl, amount);
    return { quote: quote.quote, request: quote.request };
  } catch (e) {
    console.error('Failed to create mint quote:', e);
    return null;
  }
}

/**
 * Check and redeem a mint quote after payment
 */
export async function redeemMintQuote(mintUrl: string, quoteId: string): Promise<boolean> {
  if (!manager) return false;
  try {
    await manager.quotes.redeemMintQuote(mintUrl, quoteId);
    await refreshBalances();
    return true;
  } catch (e) {
    console.error('Failed to redeem mint quote:', e);
    return false;
  }
}

/**
 * Send ecash (create a token)
 */
export async function send(mintUrl: string, amount: number): Promise<string | null> {
  if (!manager) return null;
  try {
    const token = await manager.wallet.send(mintUrl, amount);
    await refreshBalances();
    return getEncodedToken(token);
  } catch (e) {
    console.error('Failed to send:', e);
    return null;
  }
}

/**
 * Receive ecash (redeem a token)
 */
export async function receive(token: string): Promise<boolean> {
  if (!manager) return false;
  try {
    await manager.wallet.receive(token);
    await refreshBalances();
    return true;
  } catch (e) {
    console.error('Failed to receive:', e);
    return false;
  }
}

/**
 * Create a melt quote (pay Lightning invoice)
 */
export async function createMeltQuote(mintUrl: string, invoice: string): Promise<{ quote: string; amount: number; fee: number } | null> {
  if (!manager) return null;
  try {
    const quote = await manager.quotes.createMeltQuote(mintUrl, invoice);
    return {
      quote: quote.quote,
      amount: quote.amount,
      fee: quote.fee_reserve
    };
  } catch (e) {
    console.error('Failed to create melt quote:', e);
    return null;
  }
}

/**
 * Pay a melt quote (execute Lightning payment)
 */
export async function payMeltQuote(mintUrl: string, quoteId: string): Promise<boolean> {
  if (!manager) return false;
  try {
    await manager.quotes.payMeltQuote(mintUrl, quoteId);
    await refreshBalances();
    return true;
  } catch (e) {
    console.error('Failed to pay melt quote:', e);
    return false;
  }
}

/**
 * Get the wallet mnemonic (for backup)
 */
export function getMnemonic(): string | null {
  return localStorage.getItem(STORAGE_KEY_MNEMONIC);
}

/**
 * Restore wallet from mnemonic
 */
export async function restoreFromMnemonic(mnemonic: string): Promise<boolean> {
  try {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic, wordlist)) {
      return false;
    }

    // Store and reinitialize
    localStorage.setItem(STORAGE_KEY_MNEMONIC, mnemonic);
    manager = null;
    useWalletStore.getState().setWalletReady(false);
    await initWallet();
    return true;
  } catch (e) {
    console.error('Failed to restore from mnemonic:', e);
    return false;
  }
}

/**
 * Get default mint URL
 */
export function getDefaultMint(): string {
  return DEFAULT_MINT;
}

/**
 * Decode a cashu token string to inspect it
 */
export function decodeToken(token: string): { mint: string; amount: number } | null {
  try {
    const decoded = getDecodedToken(token);
    const mint = decoded.mint;
    const amount = decoded.proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
    return { mint, amount };
  } catch {
    return null;
  }
}
