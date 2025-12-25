/**
 * NIP-07 Bridge
 *
 * Handles delegation of signing/encryption to main thread.
 * Main thread has access to NIP-07 extension (window.nostr).
 */

import type { SignedEvent, UnsignedEvent, WorkerResponse } from './protocol';

// Pending request maps
const pendingSignRequests = new Map<string, (event: SignedEvent | null, error?: string) => void>();
const pendingEncryptRequests = new Map<string, (ciphertext: string | null, error?: string) => void>();
const pendingDecryptRequests = new Map<string, (plaintext: string | null, error?: string) => void>();

// Response sender (set by worker.ts)
let respond: ((msg: WorkerResponse) => void) | null = null;

/**
 * Set the response function (called by worker.ts during init)
 */
export function setResponder(responder: (msg: WorkerResponse) => void): void {
  respond = responder;
}

/**
 * Generate a unique request ID
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Request main thread to sign an event
 */
export async function requestSign(event: UnsignedEvent): Promise<SignedEvent> {
  if (!respond) {
    throw new Error('Responder not initialized');
  }

  const id = generateId('sign');

  return new Promise((resolve, reject) => {
    pendingSignRequests.set(id, (signed, error) => {
      if (error) reject(new Error(error));
      else if (signed) resolve(signed);
      else reject(new Error('Signing failed'));
    });

    respond!({ type: 'signEvent', id, event });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingSignRequests.has(id)) {
        pendingSignRequests.delete(id);
        reject(new Error('Signing timeout'));
      }
    }, 60000);
  });
}

/**
 * Request main thread to encrypt (NIP-44)
 */
export async function requestEncrypt(pubkey: string, plaintext: string): Promise<string> {
  if (!respond) {
    throw new Error('Responder not initialized');
  }

  const id = generateId('enc');

  return new Promise((resolve, reject) => {
    pendingEncryptRequests.set(id, (ciphertext, error) => {
      if (error) reject(new Error(error));
      else if (ciphertext) resolve(ciphertext);
      else reject(new Error('Encryption failed'));
    });

    respond!({ type: 'nip44Encrypt', id, pubkey, plaintext });

    setTimeout(() => {
      if (pendingEncryptRequests.has(id)) {
        pendingEncryptRequests.delete(id);
        reject(new Error('Encryption timeout'));
      }
    }, 30000);
  });
}

/**
 * Request main thread to decrypt (NIP-44)
 */
export async function requestDecrypt(pubkey: string, ciphertext: string): Promise<string> {
  if (!respond) {
    throw new Error('Responder not initialized');
  }

  const id = generateId('dec');

  return new Promise((resolve, reject) => {
    pendingDecryptRequests.set(id, (plaintext, error) => {
      if (error) reject(new Error(error));
      else if (plaintext) resolve(plaintext);
      else reject(new Error('Decryption failed'));
    });

    respond!({ type: 'nip44Decrypt', id, pubkey, ciphertext });

    setTimeout(() => {
      if (pendingDecryptRequests.has(id)) {
        pendingDecryptRequests.delete(id);
        reject(new Error('Decryption timeout'));
      }
    }, 30000);
  });
}

/**
 * Handle signed response from main thread
 */
export function handleSignedResponse(id: string, event?: SignedEvent, error?: string): void {
  const resolver = pendingSignRequests.get(id);
  if (resolver) {
    pendingSignRequests.delete(id);
    resolver(event || null, error);
  }
}

/**
 * Handle encrypted response from main thread
 */
export function handleEncryptedResponse(id: string, ciphertext?: string, error?: string): void {
  const resolver = pendingEncryptRequests.get(id);
  if (resolver) {
    pendingEncryptRequests.delete(id);
    resolver(ciphertext || null, error);
  }
}

/**
 * Handle decrypted response from main thread
 */
export function handleDecryptedResponse(id: string, plaintext?: string, error?: string): void {
  const resolver = pendingDecryptRequests.get(id);
  if (resolver) {
    pendingDecryptRequests.delete(id);
    resolver(plaintext || null, error);
  }
}
