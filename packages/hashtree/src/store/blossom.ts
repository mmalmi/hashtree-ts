/**
 * Blossom content-addressed store
 * Uses Blossom protocol for remote blob storage
 */

import { StoreWithMeta, Hash, toHex } from '../types.js';
import { sha256 } from '../hash.js';

/**
 * Blossom server configuration
 */
export interface BlossomServer {
  url: string;
  /** Whether this server accepts writes */
  write?: boolean;
}

/**
 * Blossom auth event (NIP-98 style)
 */
export interface BlossomAuthEvent {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  pubkey: string;
  id: string;
  sig: string;
}

/**
 * Signer function for Blossom auth
 */
export type BlossomSigner = (event: {
  kind: 24242;
  created_at: number;
  content: string;
  tags: string[][];
}) => Promise<BlossomAuthEvent>;

export interface BlossomStoreConfig {
  /** Blossom servers to use */
  servers: (string | BlossomServer)[];
  /** Signer for write operations */
  signer?: BlossomSigner;
}

export class BlossomStore implements StoreWithMeta {
  private servers: BlossomServer[];
  private signer?: BlossomSigner;

  constructor(config: BlossomStoreConfig) {
    this.servers = config.servers.map(s =>
      typeof s === 'string' ? { url: s, write: false } : s
    );
    this.signer = config.signer;
  }

  /**
   * Create auth header for Blossom
   */
  private async createAuthHeader(
    method: string,
    hash: Hash,
    _contentType?: string
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for authenticated requests');
    }

    const hashHex = toHex(hash);
    const expiration = Math.floor(Date.now() / 1000) + 300; // 5 min

    const tags: string[][] = [
      ['t', method.toLowerCase()],
      ['x', hashHex],
      ['expiration', expiration.toString()],
    ];

    const event = await this.signer({
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      content: `${method} ${hashHex}`,
      tags,
    });

    return `Nostr ${btoa(JSON.stringify(event))}`;
  }

  async put(hash: Hash, data: Uint8Array, contentType?: string): Promise<boolean> {
    // Verify hash matches data
    const computed = await sha256(data);
    if (toHex(computed) !== toHex(hash)) {
      throw new Error('Hash does not match data');
    }

    const writeServers = this.servers.filter(s => s.write);
    if (writeServers.length === 0) {
      throw new Error('No write-enabled server configured');
    }

    const authHeader = await this.createAuthHeader('upload', hash, contentType);
    const hashHex = toHex(hash);

    // Upload to all write-enabled servers in parallel, succeed if any succeeds
    const results = await Promise.allSettled(
      writeServers.map(async (server) => {
        const response = await fetch(`${server.url}/upload`, {
          method: 'PUT',
          headers: {
            'Authorization': authHeader,
            'Content-Type': contentType || 'application/octet-stream',
            'X-SHA-256': hashHex,
          },
          body: new Blob([data.buffer as ArrayBuffer]),
        });

        if (!response.ok && response.status !== 409) {
          const text = await response.text();
          throw new Error(`${server.url}: ${response.status} ${text}`);
        }
        return response.status !== 409; // true if new, false if already existed
      })
    );

    // Check if any succeeded
    const successes = results.filter(r => r.status === 'fulfilled');
    if (successes.length === 0) {
      // All failed - report first error
      const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      throw new Error(`Blossom upload failed: ${firstError.reason}`);
    }

    // Return true if any server stored it as new (not already existed)
    return successes.some(r => (r as PromiseFulfilledResult<boolean>).value);
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    const hashHex = toHex(hash);

    // Try each server until success
    for (const server of this.servers) {
      try {
        const response = await fetch(`${server.url}/${hashHex}`);
        if (response.ok) {
          const data = new Uint8Array(await response.arrayBuffer());
          // Verify hash
          const computed = await sha256(data);
          if (toHex(computed) === hashHex) {
            return data;
          }
          console.warn(`Hash mismatch from ${server.url}`);
        }
      } catch {
        // Try next server
        continue;
      }
    }

    return null;
  }

  async has(hash: Hash): Promise<boolean> {
    const hashHex = toHex(hash);

    for (const server of this.servers) {
      try {
        const response = await fetch(`${server.url}/${hashHex}`, {
          method: 'HEAD',
        });
        if (response.ok) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  async delete(hash: Hash): Promise<boolean> {
    const writeServer = this.servers.find(s => s.write);
    if (!writeServer) {
      throw new Error('No write-enabled server configured');
    }

    const authHeader = await this.createAuthHeader('delete', hash);
    const hashHex = toHex(hash);

    const response = await fetch(`${writeServer.url}/${hashHex}`, {
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return false;
      }
      const text = await response.text();
      throw new Error(`Blossom delete failed: ${response.status} ${text}`);
    }

    return true;
  }
}
