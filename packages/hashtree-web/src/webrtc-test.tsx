/**
 * WebRTC Connection Test Component
 *
 * This module exposes the WebRTC test functionality to window for Playwright tests.
 */

import { WebRTCStore, MemoryStore, sha256 } from 'hashtree';
import { generateSecretKey, getPublicKey, finalizeEvent, nip04, type EventTemplate } from 'nostr-tools';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface TestResults {
  pubkey: string;
  connectedPeers: number;
  peers: { pubkey: string; state: string }[];
  connectedToNosta: boolean;
  contentHash?: string;
  contentRequestResult?: {
    hash: string;
    found: boolean;
    data?: string;
  };
  error?: string;
}

declare global {
  interface Window {
    runWebRTCTest: (nostaPubkey: string | null, testContentHash?: string | null) => Promise<TestResults>;
    runWebRTCTestWithContent: (testContent: string) => Promise<TestResults>;
    testResults?: TestResults;
  }
}

export function initWebRTCTest() {
  window.runWebRTCTest = async function(nostaPubkey: string | null, testContentHash?: string | null): Promise<TestResults> {
    console.log('Starting WebRTC test...');
    if (testContentHash) {
      console.log(`Will request content hash: ${testContentHash}`);
    }

    try {
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      console.log(`Our pubkey: ${pubkey.slice(0, 16)}...`);

      const signer = async (event: EventTemplate) => finalizeEvent(event, secretKey);
      const encrypt = async (pk: string, plaintext: string) => nip04.encrypt(secretKey, pk, plaintext);
      const decrypt = async (pk: string, ciphertext: string) => nip04.decrypt(secretKey, pk, ciphertext);

      const store = new WebRTCStore({
        signer,
        pubkey,
        encrypt,
        decrypt,
        relays: ['wss://temp.iris.to'],
        helloInterval: 2000,
        satisfiedConnections: 1,
        maxConnections: 10,
        debug: true,
      });

      const results: TestResults = {
        pubkey,
        connectedPeers: 0,
        peers: [],
        connectedToNosta: false,
      };

      store.on((event) => {
        if (event.type === 'peer-connected') {
          console.log(`CONNECTED to peer: ${event.peerId.slice(0, 20)}...`);
          if (nostaPubkey && event.peerId.startsWith(nostaPubkey)) {
            results.connectedToNosta = true;
            console.log('*** CONNECTED TO NOSTA! ***');
          }
        } else if (event.type === 'peer-disconnected') {
          console.log(`DISCONNECTED from peer: ${event.peerId.slice(0, 20)}...`);
        }
      });

      console.log('Starting store...');
      await store.start();

      // Wait for connections (up to 60 seconds)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const connectedPeers = store.getConnectedCount();
        const peers = store.getPeers();
        console.log(`Check ${i + 1}: ${connectedPeers} connected peers`);

        for (const peer of peers) {
          if (peer.state === 'connected' && nostaPubkey && peer.pubkey === nostaPubkey) {
            results.connectedToNosta = true;
          }
        }

        if (results.connectedToNosta || connectedPeers > 0) {
          break;
        }
      }

      const finalPeers = store.getPeers();
      results.connectedPeers = store.getConnectedCount();
      results.peers = finalPeers.map(p => ({
        pubkey: p.pubkey.slice(0, 16),
        state: p.state,
      }));

      console.log(`Final: ${results.connectedPeers} peers, connectedToNosta=${results.connectedToNosta}`);

      // Test content request if we have a test hash and are connected
      if (testContentHash && results.connectedPeers > 0) {
        console.log(`Requesting content: ${testContentHash}`);
        try {
          // Convert hex hash to Uint8Array
          const hashBytes = new Uint8Array(testContentHash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
          const data = await store.get(hashBytes);

          if (data) {
            const textDecoder = new TextDecoder();
            const dataStr = textDecoder.decode(data);
            console.log(`*** GOT CONTENT: "${dataStr}" ***`);
            results.contentRequestResult = {
              hash: testContentHash,
              found: true,
              data: dataStr,
            };
          } else {
            console.log('Content not found');
            results.contentRequestResult = {
              hash: testContentHash,
              found: false,
            };
          }
        } catch (err) {
          console.log(`Content request error: ${err}`);
          results.contentRequestResult = {
            hash: testContentHash,
            found: false,
          };
        }
      }

      await store.stop();

      window.testResults = results;
      return results;
    } catch (err) {
      const error = String(err);
      console.log(`Error: ${error}`);
      const results: TestResults = {
        pubkey: '',
        connectedPeers: 0,
        peers: [],
        connectedToNosta: false,
        error
      };
      window.testResults = results;
      return results;
    }
  };

  // Function to run as content provider (has content to serve)
  window.runWebRTCTestWithContent = async function(testContent: string): Promise<TestResults> {
    console.log('Starting WebRTC test with content...');

    try {
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      console.log(`Our pubkey: ${pubkey.slice(0, 16)}...`);

      const signer = async (event: EventTemplate) => finalizeEvent(event, secretKey);
      const encrypt = async (pk: string, plaintext: string) => nip04.encrypt(secretKey, pk, plaintext);
      const decrypt = async (pk: string, ciphertext: string) => nip04.decrypt(secretKey, pk, ciphertext);

      // Create memory store with test content
      const localStore = new MemoryStore();
      const contentBytes = new TextEncoder().encode(testContent);
      const contentHash = await sha256(contentBytes);
      await localStore.put(contentHash, contentBytes);
      const contentHashHex = bytesToHex(contentHash);
      console.log(`Stored content with hash: ${contentHashHex.slice(0, 16)}...`);

      const store = new WebRTCStore({
        signer,
        pubkey,
        encrypt,
        decrypt,
        localStore,
        relays: ['wss://temp.iris.to'],
        helloInterval: 2000,
        satisfiedConnections: 1,
        maxConnections: 10,
        debug: true,
      });

      const results: TestResults = {
        pubkey,
        connectedPeers: 0,
        peers: [],
        connectedToNosta: false,
        contentHash: contentHashHex,
      };

      // Set testResults early so the test can read pubkey and contentHash
      window.testResults = results;

      store.on((event) => {
        if (event.type === 'peer-connected') {
          console.log(`CONNECTED to peer: ${event.peerId.slice(0, 20)}...`);
        } else if (event.type === 'peer-disconnected') {
          console.log(`DISCONNECTED from peer: ${event.peerId.slice(0, 20)}...`);
        }
      });

      console.log('Starting store with content...');
      await store.start();

      // Wait for connections (up to 60 seconds)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const connectedPeers = store.getConnectedCount();
        console.log(`Check ${i + 1}: ${connectedPeers} connected peers`);

        if (connectedPeers > 0) {
          // Stay connected a bit longer to serve requests
          await new Promise(r => setTimeout(r, 5000));
          break;
        }
      }

      const finalPeers = store.getPeers();
      results.connectedPeers = store.getConnectedCount();
      results.peers = finalPeers.map(p => ({
        pubkey: p.pubkey.slice(0, 16),
        state: p.state,
      }));

      console.log(`Final: ${results.connectedPeers} peers`);

      await store.stop();

      window.testResults = results;
      return results;
    } catch (err) {
      const error = String(err);
      console.log(`Error: ${error}`);
      const results: TestResults = {
        pubkey: '',
        connectedPeers: 0,
        peers: [],
        connectedToNosta: false,
        error
      };
      window.testResults = results;
      return results;
    }
  };

  console.log('WebRTC test initialized. Call window.runWebRTCTest(nostaPubkey) to start.');
}
