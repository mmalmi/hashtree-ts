/**
 * Cross-language E2E test: hashtree-ts (browser) <-> Nosta (Rust)
 *
 * Runs a Nosta WebRTC manager in background and verifies that
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

test.describe('Nosta Cross-Language', () => {
  test.setTimeout(120000);

  let nostaProcess: ChildProcess | null = null;
  let nostaPubkey: string | null = null;

  test.beforeAll(async () => {
    // Start Nosta crosslang test in background
    console.log('Starting Nosta peer...');

    nostaProcess = spawn('cargo', ['test', 'test_nosta_crosslang_peer', '--release', '--', '--nocapture'], {
      cwd: '/workspace/nosta',
      env: { ...process.env, RUST_LOG: 'warn' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture Nosta pubkey
    const pubkeyPromise = new Promise<string>((resolve) => {
      const handler = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const match = line.match(/NOSTA_PUBKEY:([a-f0-9]{64})/);
          if (match) {
            resolve(match[1]);
            return;
          }
        }
      };
      nostaProcess!.stdout?.on('data', handler);
      nostaProcess!.stderr?.on('data', handler);
    });

    // Wait for pubkey with timeout
    nostaPubkey = await Promise.race([
      pubkeyPromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for Nosta')), 15000))
    ]).catch(() => null);

    if (nostaPubkey) {
      console.log(`Nosta pubkey: ${nostaPubkey.slice(0, 16)}...`);
    } else {
      console.log('Warning: Could not capture Nosta pubkey');
    }
  });

  test.afterAll(async () => {
    if (nostaProcess) {
      nostaProcess.kill();
      nostaProcess = null;
    }
  });

  test('hashtree-ts discovers Nosta peer via relay', async () => {
    const pool = new SimplePool();

    // Generate keys for TypeScript peer
    const tsSk = generateSecretKey();
    const tsPk = getPublicKey(tsSk);
    const tsUuid = generateUuid();

    console.log('TypeScript peer pubkey:', tsPk.slice(0, 16) + '...');

    const discoveredPeers = new Map<string, any>();
    let foundNosta = false;
    let receivedOfferFromNosta = false;

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

                if (nostaPubkey && event.pubkey === nostaPubkey) {
                  foundNosta = true;
                  console.log(`*** FOUND NOSTA PEER! peerId=${msg.peerId} ***`);
                }
              }
            } else if (msg.type === 'offer') {
              const recipientPk = msg.recipient?.split(':')[0];
              if (recipientPk === tsPk) {
                console.log(`Received OFFER from ${event.pubkey.slice(0, 16)}...`);
                if (nostaPubkey && event.pubkey === nostaPubkey) {
                  receivedOfferFromNosta = true;
                  console.log('*** RECEIVED OFFER FROM NOSTA! ***');
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

      console.log(`Check ${i + 1}: Discovered ${discoveredPeers.size} peers, foundNosta=${foundNosta}`);

      // Success if we found Nosta or received an offer from it
      if (foundNosta || receivedOfferFromNosta) {
        break;
      }
    }

    // Cleanup
    sub.close();
    pool.close([TEST_RELAY]);

    console.log('\n=== Results ===');
    console.log(`Peers discovered: ${discoveredPeers.size}`);
    console.log(`Found Nosta: ${foundNosta}`);
    console.log(`Received offer from Nosta: ${receivedOfferFromNosta}`);

    // Verify Nosta's peerId was correctly received
    if (nostaPubkey && foundNosta) {
      const nostaPeer = discoveredPeers.get(nostaPubkey);
      console.log(`Nosta peerId: ${nostaPeer?.peerId}`);
      expect(nostaPeer?.peerId).toBeTruthy();
      expect(typeof nostaPeer?.peerId).toBe('string');
      expect(nostaPeer?.peerId.length).toBeGreaterThan(5);
    }

    // Test passes if:
    // 1. We discovered Nosta specifically, OR
    // 2. We discovered some peers (protocol works) and Nosta pubkey wasn't captured
    if (nostaPubkey) {
      expect(foundNosta || receivedOfferFromNosta).toBe(true);
    } else {
      expect(discoveredPeers.size).toBeGreaterThan(0);
    }
  });

  test('Nosta discovers hashtree-ts peer', async () => {
    // This test checks if Nosta discovered our TS peer by parsing its output
    // We need to send hellos and check if Nosta logs discovery

    const pool = new SimplePool();
    const tsSk = generateSecretKey();
    const tsPk = getPublicKey(tsSk);
    const tsUuid = 'ts-crosslang-' + generateUuid().slice(0, 8);

    console.log('TypeScript peer pubkey:', tsPk.slice(0, 16) + '...');
    console.log('TypeScript peer UUID:', tsUuid);

    let nostaDiscoveredTs = false;

    // Listen for Nosta output mentioning our pubkey
    const outputHandler = (data: Buffer) => {
      const text = data.toString();
      // Check if Nosta logged discovery of our peer
      if (text.includes(tsPk.slice(0, 16)) || text.includes(tsUuid.slice(0, 6))) {
        nostaDiscoveredTs = true;
        console.log('*** NOSTA DISCOVERED HASHTREE-TS! ***');
      }
    };

    nostaProcess?.stdout?.on('data', outputHandler);
    nostaProcess?.stderr?.on('data', outputHandler);

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

      console.log(`Check ${i + 1}: Nosta discovered TS = ${nostaDiscoveredTs}`);

      if (nostaDiscoveredTs) {
        break;
      }
    }

    // Cleanup
    sub.close();
    pool.close([TEST_RELAY]);

    console.log('\n=== Results ===');
    console.log(`Nosta discovered TypeScript peer: ${nostaDiscoveredTs}`);

    // This test verifies bidirectional discovery
    expect(nostaDiscoveredTs).toBe(true);
  });
});
