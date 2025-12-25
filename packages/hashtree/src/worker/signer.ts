/**
 * Worker Signer
 *
 * NDK signer that delegates signing/encryption to main thread.
 * Main thread handles NIP-07 extension or private key operations.
 */

import type { NDKSigner, NDKEncryptionScheme } from '@nostr-dev-kit/ndk';
import { NDKUser, type NostrEvent } from '@nostr-dev-kit/ndk';
import { requestSign, requestEncrypt, requestDecrypt } from './nip07-bridge';

export class WorkerSigner implements NDKSigner {
  private _pubkey: string;
  private _user: NDKUser;
  private _ready = false;
  private _readyPromise: Promise<NDKUser>;
  private _readyResolve!: (user: NDKUser) => void;

  constructor(pubkey: string) {
    this._pubkey = pubkey;
    this._user = new NDKUser({ pubkey });
    this._readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /**
   * Mark the signer as ready (called after pubkey is confirmed)
   */
  setReady(): void {
    this._ready = true;
    this._readyResolve(this._user);
  }

  /**
   * Update the pubkey (e.g., when user logs in)
   */
  setPubkey(pubkey: string): void {
    this._pubkey = pubkey;
    this._user = new NDKUser({ pubkey });
    if (!this._ready) {
      this.setReady();
    }
  }

  get pubkey(): string {
    if (!this._ready) {
      throw new Error('Not ready');
    }
    return this._pubkey;
  }

  get userSync(): NDKUser {
    return this._user;
  }

  async blockUntilReady(): Promise<NDKUser> {
    return this._readyPromise;
  }

  async user(): Promise<NDKUser> {
    return this._readyPromise;
  }

  /**
   * Sign an event by delegating to main thread
   */
  async sign(event: NostrEvent): Promise<string> {
    // requestSign expects UnsignedEvent and returns SignedEvent
    const unsigned = {
      kind: event.kind!,
      created_at: event.created_at!,
      tags: event.tags,
      content: event.content,
      pubkey: event.pubkey,
    };

    const signed = await requestSign(unsigned);
    return signed.sig;
  }

  /**
   * Check supported encryption schemes
   */
  async encryptionEnabled(scheme?: NDKEncryptionScheme): Promise<NDKEncryptionScheme[]> {
    // We support NIP-44 encryption via main thread
    const supported: NDKEncryptionScheme[] = ['nip44'];

    if (scheme) {
      return supported.includes(scheme) ? [scheme] : [];
    }
    return supported;
  }

  /**
   * Encrypt a value for a recipient
   */
  async encrypt(recipient: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
    if (scheme && scheme !== 'nip44') {
      throw new Error(`Unsupported encryption scheme: ${scheme}`);
    }

    const recipientPubkey = recipient.pubkey;
    return requestEncrypt(recipientPubkey, value);
  }

  /**
   * Decrypt a value from a sender
   */
  async decrypt(sender: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
    if (scheme && scheme !== 'nip44') {
      throw new Error(`Unsupported decryption scheme: ${scheme}`);
    }

    const senderPubkey = sender.pubkey;
    return requestDecrypt(senderPubkey, value);
  }

  /**
   * Serialize the signer
   */
  toPayload(): string {
    return JSON.stringify({
      type: 'worker',
      payload: this._pubkey,
    });
  }
}

// Singleton instance
let instance: WorkerSigner | null = null;

export function getWorkerSigner(): WorkerSigner | null {
  return instance;
}

export function initWorkerSigner(pubkey: string): WorkerSigner {
  if (instance) {
    instance.setPubkey(pubkey);
  } else {
    instance = new WorkerSigner(pubkey);
    instance.setReady();
  }
  return instance;
}

export function clearWorkerSigner(): void {
  instance = null;
}
