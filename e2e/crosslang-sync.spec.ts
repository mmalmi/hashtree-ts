/**
 * Cross-language E2E sync test: hashtree-ts (browser) <-> hashtree-rs (Rust)
 *
 * This test verifies actual content sync between TypeScript and Rust implementations:
 * 1. Pre-generates keypairs for both sides so they can mutually follow from start
 * 2. Spawns a hashtree-rs server with test content
 * 3. Uses Playwright to run hashtree-ts in a browser
 * 4. Establishes WebRTC connection between them
 * 5. Verifies content can be synced from Rust to TypeScript
 *
 * Run with: npm run test:e2e -- crosslang-sync
 * Requires: cargo/Rust toolchain installed
 */

import { test, expect } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import { setupPageErrorHandler } from './test-utils.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { nip19, generateSecretKey, getPublicKey } from 'nostr-tools';

// Run tests in this file serially to avoid WebRTC/timing conflicts
test.describe.configure({ mode: 'serial' });

const LOCAL_RELAY = 'ws://localhost:4736';

// Simple bytesToHex implementation
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate a keypair and return all formats
function generateKeypair() {
  const secretKey = generateSecretKey();
  const pubkeyHex = getPublicKey(secretKey);
  const nsec = nip19.nsecEncode(secretKey);
  const npub = nip19.npubEncode(pubkeyHex);
  return { secretKey, pubkeyHex, nsec, npub };
}

// Check if cargo is available
function hasRustToolchain(): boolean {
  try {
    execSync('cargo --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Build htree binary if needed
function ensureHtreeBinary(): string | null {
  try {
    const workspaceRoot = path.resolve(__dirname, '../../hashtree-rs');

    // Try to find existing binary
    const debugBin = path.join(workspaceRoot, 'target/debug/htree');
    const releaseBin = path.join(workspaceRoot, 'target/release/htree');

    try {
      execSync(`test -f ${debugBin}`, { stdio: 'ignore' });
      return debugBin;
    } catch {}

    try {
      execSync(`test -f ${releaseBin}`, { stdio: 'ignore' });
      return releaseBin;
    } catch {}

    // Build the binary
    console.log('Building htree binary...');
    execSync('cargo build --bin htree', { cwd: workspaceRoot, stdio: 'inherit' });
    return debugBin;
  } catch (e) {
    console.log('Failed to build htree:', e);
    return null;
  }
}

test.describe('Cross-Language Sync', () => {
  test.setTimeout(180000); // 3 minutes

  test('hashtree-ts syncs content from hashtree-rs via WebRTC', async ({ page }) => {
    // Skip if no Rust toolchain
    if (!hasRustToolchain()) {
      test.skip(true, 'Rust toolchain not available');
      return;
    }

    const htreeBin = ensureHtreeBinary();
    if (!htreeBin) {
      test.skip(true, 'Could not build htree binary');
      return;
    }

    setupPageErrorHandler(page);

    // Pre-generate Rust keypair so TS can follow it immediately on startup
    const rustKeys = generateKeypair();
    console.log(`[Pre-gen] Rust npub: ${rustKeys.npub.slice(0, 20)}...`);

    let rustProcess: ChildProcess | null = null;
    let contentHash: string | null = null;
    let tsPubkeyHex: string | null = null;

    try {
      // ===== STEP 1: Start TS app and wait for full initialization =====
      console.log('[TS] Starting app...');
      await page.goto('http://localhost:5173');

      // Page ready - navigateToPublicFolder handles waiting

      // Wait for app to fully initialize (pubkey exists)
      await expect(page.getByRole('link', { name: 'public' }).first()).toBeVisible({ timeout: 20000 });

      // Get TS pubkey for Rust
      tsPubkeyHex = await page.evaluate(() => {
        const nostrStore = (window as any).__nostrStore;
        return nostrStore?.getState()?.pubkey || null;
      });

      if (!tsPubkeyHex) {
        throw new Error('Could not get TS pubkey');
      }
      console.log(`[TS] Pubkey: ${tsPubkeyHex.slice(0, 16)}...`);

      // ===== STEP 2: Configure TS to accept the Rust peer =====
      // Wait for WebRTC store to be initialized, then set peer classifier and local relay
      // Use window-exposed getters to avoid Vite module duplication issues
      console.log('[TS] Waiting for WebRTC store and configuring...');
      const configResult = await page.evaluate(async ({ rustPubkey, localRelay }) => {
        // Use window-exposed getter (from main.ts) to get the actual store instance
        const getWebRTCStore = (window as any).__getWebRTCStore;
        const settingsStore = (window as any).__settingsStore;

        if (!getWebRTCStore) {
          return { success: false, reason: '__getWebRTCStore not exposed on window' };
        }

        // Wait up to 10s for webrtcStore to be initialized
        let webrtcStore = getWebRTCStore();
        let retries = 0;
        while (!webrtcStore && retries < 50) {
          await new Promise(r => setTimeout(r, 200));
          webrtcStore = getWebRTCStore();
          retries++;
        }

        if (!webrtcStore) {
          return { success: false, reason: 'no webrtcStore after 10s' };
        }

        console.log('[TS] WebRTC store initialized after', retries * 200, 'ms');

        try {
          // 1. Set peer classifier that allows the Rust pubkey
          webrtcStore.setPeerClassifier((pubkey: string) => {
            if (pubkey === rustPubkey) {
              console.log('[TS] Classifier: allowing Rust peer as follows');
              return 'follows';
            }
            return 'other';
          });
          console.log('[TS] Peer classifier set for Rust:', rustPubkey.slice(0, 16));

          // 2. Update settings for future store creations
          if (settingsStore) {
            settingsStore.setNetworkSettings({ relays: [localRelay] });
          }

          // 3. Switch to local relay - this clears peers and starts fresh subscriptions
          // with the classifier we just set
          if (typeof webrtcStore.setRelays === 'function') {
            webrtcStore.setRelays([localRelay]);
            console.log('[TS] Switched to local relay:', localRelay);
          }

          return { success: true };
        } catch (e) {
          return { success: false, reason: String(e) };
        }
      }, { rustPubkey: rustKeys.pubkeyHex, localRelay: LOCAL_RELAY });
      console.log('[TS] Config result:', configResult);

      // ===== STEP 3: Start Rust server with TS in follows =====
      console.log('[Rust] Starting hashtree-rs server...');

      const workspaceRoot = path.resolve(__dirname, '../../hashtree-rs');

      // Pass both keys via environment - Rust uses its key and follows TS
      // Also pass local relay URL for deterministic signaling
      rustProcess = spawn('cargo', [
        'test', '--package', 'hashtree-cli', '--test', 'crosslang_peer',
        '--', '--nocapture', '--test-threads=1'
      ], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          RUST_LOG: 'warn,hashtree_cli::webrtc=debug',
          CROSSLANG_SECRET_KEY: bytesToHex(rustKeys.secretKey),
          CROSSLANG_FOLLOW_PUBKEY: tsPubkeyHex,
          LOCAL_RELAY: LOCAL_RELAY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Log browser console for Rust peer events
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('WebRTC') || text.includes('Peer') ||
            text.includes('connected') || text.includes('Connection')) {
          console.log(`[TS] ${text}`);
        }
      });

      // Capture Rust output
      const rustOutputHandler = (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const hashMatch = line.match(/CROSSLANG_HASH:([a-f0-9]{64})/);
          if (hashMatch) contentHash = hashMatch[1];

          // Log relay connections, hello sends, and crosslang markers
          if (line.includes('CROSSLANG_') || line.includes('Peers:') || line.includes('connected') || line.includes('[Peer') || line.includes('Received') || line.includes('store') ||
              line.includes('relay') || line.includes('hello') || line.includes('Subscribed') || line.includes('Connecting')) {
            console.log(`[Rust] ${line.trim()}`);
          }
        }
      };

      rustProcess.stdout?.on('data', rustOutputHandler);
      rustProcess.stderr?.on('data', rustOutputHandler);

      // Wait for Rust server to output the content hash
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Rust server timeout')), 60000);
        const check = setInterval(() => {
          if (contentHash) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
          }
        }, 500);
      });

      console.log(`[Rust] Ready! Content hash: ${contentHash!.slice(0, 16)}...`);

      // ===== STEP 4: Wait for WebRTC connection =====
      console.log('[TS] Waiting for WebRTC connection to Rust peer...');

      let connectedToRust = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);

        const peerInfo = await page.evaluate((rustPk) => {
          // Use window-exposed getter to get the actual store instance
          const getWebRTCStore = (window as any).__getWebRTCStore;
          const webrtcStore = getWebRTCStore?.();
          const peers = webrtcStore?.getPeers?.() || [];
          const rustPeer = peers.find((p: any) => p.pubkey === rustPk);
          return {
            total: peers.length,
            connected: peers.filter((p: any) => p.state === 'connected').length,
            rustPeer: rustPeer ? { state: rustPeer.state, pool: rustPeer.pool } : null,
          };
        }, rustKeys.pubkeyHex);

        console.log(`[TS] Check ${i + 1}: ${peerInfo.connected}/${peerInfo.total} peers, Rust: ${JSON.stringify(peerInfo.rustPeer)}`);

        if (peerInfo.rustPeer?.state === 'connected') {
          connectedToRust = true;
          console.log('[TS] Connected to Rust peer!');
          break;
        }
      }

      // ===== STEP 5: Request content via WebRTC =====
      console.log(`[TS] Requesting content: ${contentHash!.slice(0, 16)}...`);

      const content = await page.evaluate(async (hashHex) => {
        // Use window-exposed getter to get the actual store instance
        const getWebRTCStore = (window as any).__getWebRTCStore;
        const webrtcStore = getWebRTCStore?.();
        if (!webrtcStore?.get) return null;

        // Convert hex string to Uint8Array
        const hexToBytes = (hex: string): Uint8Array => {
          const bytes = new Uint8Array(hex.length / 2);
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
          }
          return bytes;
        };
        const hash = hexToBytes(hashHex);

        try {
          const result = await Promise.race([
            webrtcStore.get(hash),
            new Promise<null>(r => setTimeout(() => r(null), 15000)),
          ]);
          if (result) {
            return { source: 'webrtc', data: new TextDecoder().decode(result as Uint8Array) };
          }
        } catch (e) {
          console.log('WebRTC get error:', e);
        }
        return null;
      }, contentHash);

      console.log('[TS] Content result:', content);

      // ===== VERIFY =====
      if (content) {
        console.log(`\n=== SUCCESS: Content synced via WebRTC! ===`);
        console.log(`Content: ${content.data}`);
        expect(content.data).toContain('Hello from hashtree-rs');
      } else {
        console.log('\n=== WebRTC sync failed ===');
        console.log(`Connected to Rust: ${connectedToRust}`);
      }

      expect(content).not.toBeNull();
      expect(content?.source).toBe('webrtc');

    } finally {
      if (rustProcess) {
        rustProcess.kill();
      }
    }
  });
});
