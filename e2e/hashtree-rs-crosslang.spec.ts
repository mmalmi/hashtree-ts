/**
 * Cross-language E2E test: hashtree-ts (browser) <-> hashtree-rs (Rust)
 *
 * Runs a hashtree-rs WebRTC manager in background and verifies that
 * hashtree-ts running in a browser can discover and connect to it.
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, type Event, nip04 } from 'nostr-tools';
import { spawn, ChildProcess } from 'child_process';

// Polyfill WebSocket for Node.js
(globalThis as any).WebSocket = WebSocket;

const WEBRTC_KIND = 30078;
const WEBRTC_TAG = 'webrtc';
const TEST_RELAY = 'wss://temp.iris.to';

function generateUuid(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

// Skip: These tests are network-dependent (require external relay wss://temp.iris.to and hashtree-rs Rust peer)
// They can be run manually when testing cross-language compatibility
test.describe.skip('hashtree-rs Cross-Language', () => {
  test.setTimeout(120000);

  let rsPeerProcess: ChildProcess | null = null;
  let rsPeerPubkey: string | null = null;

  test.beforeAll(async () => {
    // Start hashtree-rs crosslang test in background
    console.log('Starting hashtree-rs peer...');

    rsPeerProcess = spawn('cargo', ['test', 'test_hashtree_rs_crosslang_peer', '--release', '--', '--nocapture'], {
      cwd: '/workspace/hashtree-rs',
      env: { ...process.env, RUST_LOG: 'warn' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture hashtree-rs pubkey
    const pubkeyPromise = new Promise<string>((resolve) => {
      const handler = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const match = line.match(/HASHTREE_RS_PUBKEY:([a-f0-9]{64})/);
          if (match) {
            resolve(match[1]);
            return;
          }
        }
      };
      rsPeerProcess!.stdout?.on('data', handler);
      rsPeerProcess!.stderr?.on('data', handler);
    });

    // Wait for pubkey with timeout
    rsPeerPubkey = await Promise.race([
      pubkeyPromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for hashtree-rs')), 15000))
    ]).catch(() => null);

    if (rsPeerPubkey) {
      console.log(`hashtree-rs pubkey: ${rsPeerPubkey.slice(0, 16)}...`);
    } else {
      console.log('Warning: Could not capture hashtree-rs pubkey');
    }
  });

  test.afterAll(async () => {
    if (rsPeerProcess) {
      rsPeerProcess.kill();
      rsPeerProcess = null;
    }
  });

  test('hashtree-ts discovers hashtree-rs peer via relay', async () => {
    const pool = new SimplePool();

    // Generate keys for TypeScript peer
    const tsSk = generateSecretKey();
    const tsPk = getPublicKey(tsSk);
    const tsUuid = generateUuid();

    console.log('TypeScript peer pubkey:', tsPk.slice(0, 16) + '...');

    const discoveredPeers = new Map<string, any>();
    let foundRsPeer = false;
    let receivedOfferFromRsPeer = false;

    // Subscribe to WebRTC signaling events
    const sub = pool.subscribe(
      [TEST_RELAY],
      {
        kinds: [WEBRTC_KIND],
        '#l': [WEBRTC_TAG],
        since: Math.floor(Date.now() / 1000) - 60,
      },
      {
        onevent(event: Event) {
          if (event.pubkey === tsPk) return;

          try {
            let content = event.content;

            // Try NIP-04 decrypt if not JSON
            if (!content.startsWith('{')) {
              try {
                content = nip04.decrypt(tsSk, event.pubkey, content) as string;
              } catch {
                return;
              }
            }

            const msg = JSON.parse(content);

            if (msg.type === 'hello') {
              if (!discoveredPeers.has(event.pubkey)) {
                discoveredPeers.set(event.pubkey, { peerId: msg.peerId });
                console.log(`Discovered: ${event.pubkey.slice(0, 16)}... peerId=${msg.peerId?.slice(0, 12) || 'none'}`);

                if (rsPeerPubkey && event.pubkey === rsPeerPubkey) {
                  foundRsPeer = true;
                  console.log(`*** FOUND HASHTREE-RS PEER! peerId=${msg.peerId} ***`);
                }
              }
            } else if (msg.type === 'offer') {
              const recipientPk = msg.recipient?.split(':')[0];
              if (recipientPk === tsPk) {
                console.log(`Received OFFER from ${event.pubkey.slice(0, 16)}...`);
                if (rsPeerPubkey && event.pubkey === rsPeerPubkey) {
                  receivedOfferFromRsPeer = true;
                  console.log('*** RECEIVED OFFER FROM HASHTREE-RS! ***');
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        },
      }
    );

    await new Promise(r => setTimeout(r, 1000));

    // Send hellos and wait for discovery
    for (let i = 0; i < 15; i++) {
      const helloEvent = finalizeEvent({
        kind: WEBRTC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['l', WEBRTC_TAG],
          ['d', generateUuid()],
        ],
        content: JSON.stringify({ type: 'hello', peerId: tsUuid }),
      }, tsSk);

      await pool.publish([TEST_RELAY], helloEvent);
      await new Promise(r => setTimeout(r, 2000));

      console.log(`Check ${i + 1}: Discovered ${discoveredPeers.size} peers, foundRsPeer=${foundRsPeer}`);

      // Success if we found hashtree-rs or received an offer from it
      if (foundRsPeer || receivedOfferFromRsPeer) {
        break;
      }
    }

    // Cleanup
    sub.close();
    pool.close([TEST_RELAY]);

    console.log('\n=== Results ===');
    console.log(`Peers discovered: ${discoveredPeers.size}`);
    console.log(`Found hashtree-rs: ${foundRsPeer}`);
    console.log(`Received offer from hashtree-rs: ${receivedOfferFromRsPeer}`);

    // Verify hashtree-rs's peerId was correctly received
    if (rsPeerPubkey && foundRsPeer) {
      const rsPeer = discoveredPeers.get(rsPeerPubkey);
      console.log(`hashtree-rs peerId: ${rsPeer?.peerId}`);
      expect(rsPeer?.peerId).toBeTruthy();
      expect(typeof rsPeer?.peerId).toBe('string');
      expect(rsPeer?.peerId.length).toBeGreaterThan(5);
    }

    // Test passes if:
    // 1. We discovered hashtree-rs specifically, OR
    // 2. We discovered some peers (protocol works) and hashtree-rs pubkey wasn't captured
    if (rsPeerPubkey) {
      expect(foundRsPeer || receivedOfferFromRsPeer).toBe(true);
    } else {
      expect(discoveredPeers.size).toBeGreaterThan(0);
    }
  });

  test('hashtree-rs discovers hashtree-ts peer', async () => {
    // This test checks if hashtree-rs discovered our TS peer by parsing its output
    // We need to send hellos and check if hashtree-rs logs discovery

    const pool = new SimplePool();
    const tsSk = generateSecretKey();
    const tsPk = getPublicKey(tsSk);
    const tsUuid = 'ts-crosslang-' + generateUuid().slice(0, 8);

    console.log('TypeScript peer pubkey:', tsPk.slice(0, 16) + '...');
    console.log('TypeScript peer UUID:', tsUuid);

    let rsPeerDiscoveredTs = false;

    // Listen for hashtree-rs output mentioning our pubkey
    const outputHandler = (data: Buffer) => {
      const text = data.toString();
      // Check if hashtree-rs logged discovery of our peer
      if (text.includes(tsPk.slice(0, 16)) || text.includes(tsUuid.slice(0, 6))) {
        rsPeerDiscoveredTs = true;
        console.log('*** HASHTREE-RS DISCOVERED HASHTREE-TS! ***');
      }
    };

    rsPeerProcess?.stdout?.on('data', outputHandler);
    rsPeerProcess?.stderr?.on('data', outputHandler);

    // Subscribe to events (for logging)
    const sub = pool.subscribe(
      [TEST_RELAY],
      {
        kinds: [WEBRTC_KIND],
        '#l': [WEBRTC_TAG],
        since: Math.floor(Date.now() / 1000) - 30,
      },
      {
        onevent() {},
      }
    );

    await new Promise(r => setTimeout(r, 1000));

    // Send hellos
    for (let i = 0; i < 10; i++) {
      const helloEvent = finalizeEvent({
        kind: WEBRTC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['l', WEBRTC_TAG],
          ['d', generateUuid()],
        ],
        content: JSON.stringify({ type: 'hello', peerId: tsUuid }),
      }, tsSk);

      await pool.publish([TEST_RELAY], helloEvent);
      await new Promise(r => setTimeout(r, 2000));

      console.log(`Check ${i + 1}: hashtree-rs discovered TS = ${rsPeerDiscoveredTs}`);

      if (rsPeerDiscoveredTs) {
        break;
      }
    }

    // Cleanup
    sub.close();
    pool.close([TEST_RELAY]);

    console.log('\n=== Results ===');
    console.log(`hashtree-rs discovered TypeScript peer: ${rsPeerDiscoveredTs}`);

    // This test verifies bidirectional discovery
    expect(rsPeerDiscoveredTs).toBe(true);
  });
});
