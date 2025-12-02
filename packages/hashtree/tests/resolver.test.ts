/**
 * RefResolver tests using temp.iris.to relay
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKFilter, type NDKSubscriptionOptions } from '@nostr-dev-kit/ndk';
import { nip19, generateSecretKey, getPublicKey } from 'nostr-tools';
import { createNostrRefResolver, type NostrFilter, type NostrEvent } from '../src/resolver/nostr.js';
import { toHex, fromHex } from '../src/types.js';

// NDK requires WebSocket to be available globally in Node.js
// @ts-ignore
globalThis.WebSocket = WebSocket;

// Use temp.iris.to for testing (ephemeral relay)
const TEST_RELAY = 'wss://temp.iris.to';

/**
 * Create subscribe and publish functions from NDK instance
 */
function createNostrFunctions(ndk: NDK) {
  return {
    subscribe: (filter: NostrFilter, onEvent: (event: NostrEvent) => void) => {
      const ndkFilter: NDKFilter = {
        kinds: filter.kinds,
        authors: filter.authors,
        '#d': filter['#d'],
        '#l': filter['#l'],
      };
      const opts: NDKSubscriptionOptions = { closeOnEose: false };
      const sub = ndk.subscribe(ndkFilter, opts);
      sub.on('event', (e: NDKEvent) => {
        onEvent({
          id: e.id,
          pubkey: e.pubkey,
          kind: e.kind ?? 30078,
          content: e.content,
          tags: e.tags,
          created_at: e.created_at ?? 0,
        });
      });
      return () => sub.stop();
    },
    publish: async (event: Omit<NostrEvent, 'id' | 'pubkey' | 'created_at'>) => {
      try {
        const ndkEvent = new NDKEvent(ndk);
        ndkEvent.kind = event.kind;
        ndkEvent.content = event.content;
        ndkEvent.tags = event.tags;
        await ndkEvent.publish();
        return true;
      } catch (e) {
        console.error('Failed to publish event:', e);
        return false;
      }
    },
  };
}

describe('NostrRefResolver', () => {
  let ndk: NDK;
  let secretKey: Uint8Array;
  let pubkey: string;
  let npub: string;

  beforeAll(async () => {
    // Generate test keypair
    secretKey = generateSecretKey();
    pubkey = getPublicKey(secretKey);
    npub = nip19.npubEncode(pubkey);

    // Create NDK instance
    const nsec = nip19.nsecEncode(secretKey);
    ndk = new NDK({
      explicitRelayUrls: [TEST_RELAY],
      signer: new NDKPrivateKeySigner(nsec),
    });

    // Set up connection promise before calling connect
    const connectionPromise = new Promise<void>((resolve) => {
      ndk.pool.once('relay:connect', () => resolve());
    });

    // Start connecting (doesn't wait for actual connection)
    ndk.connect();

    // Wait for relay to actually connect
    await connectionPromise;
  }, 10000);

  afterAll(() => {
    // NDK doesn't have a clean disconnect, but we can let it GC
  });

  it('should timeout for unpublished key', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    // resolve() waits indefinitely, so we use timeout on caller side
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    const result = await Promise.race([
      resolver.resolve(`${npub}/unpublished-key-${Date.now()}`),
      timeoutPromise,
    ]);
    expect(result).toBeNull(); // Timeout returned null

    resolver.stop?.();
  });

  it('should publish and resolve a hash', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    const treeName = `test-tree-${Date.now()}`;
    const key = `${npub}/${treeName}`;
    const testHash = fromHex('abcd'.repeat(16)); // 32 bytes

    // Publish
    const published = await resolver.publish!(key, testHash);
    expect(published).toBe(true);

    // Wait for relay to process
    await new Promise(r => setTimeout(r, 500));

    // Resolve
    const resolved = await resolver.resolve(key);
    expect(resolved).not.toBeNull();
    expect(toHex(resolved!)).toBe(toHex(testHash));

    resolver.stop?.();
  });

  it('should list trees for a user', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    // Publish a couple of trees
    const tree1 = `list-test-1-${Date.now()}`;
    const tree2 = `list-test-2-${Date.now()}`;
    const hash1 = fromHex('1111'.repeat(16));
    const hash2 = fromHex('2222'.repeat(16));

    await resolver.publish!(`${npub}/${tree1}`, hash1);
    await resolver.publish!(`${npub}/${tree2}`, hash2);

    // Wait for relay
    await new Promise(r => setTimeout(r, 500));

    // List with callback (wait for results then unsubscribe)
    const trees = await new Promise<Array<{ key: string; hash: Uint8Array }>>((resolve) => {
      let lastEntries: Array<{ key: string; hash: Uint8Array }> = [];
      const unsubscribe = resolver.list!(npub, (entries) => {
        lastEntries = entries;
      });
      // Wait a bit for entries to come in, then resolve
      setTimeout(() => {
        unsubscribe();
        resolve(lastEntries);
      }, 1000);
    });

    expect(trees.length).toBeGreaterThanOrEqual(2);

    const names = trees.map(t => t.key.split('/')[1]);
    expect(names).toContain(tree1);
    expect(names).toContain(tree2);

    resolver.stop?.();
  });

  it('should subscribe and receive updates', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    const treeName = `subscribe-test-${Date.now()}`;
    const key = `${npub}/${treeName}`;
    const initialHash = fromHex('aaaa'.repeat(16));
    const updatedHash = fromHex('bbbb'.repeat(16));

    // Publish initial value
    await resolver.publish!(key, initialHash);
    await new Promise(r => setTimeout(r, 500));

    // Subscribe
    const receivedHashes: string[] = [];
    const unsubscribe = resolver.subscribe(key, (hash) => {
      if (hash) {
        receivedHashes.push(toHex(hash));
      }
    });

    // Wait for initial callback
    await new Promise(r => setTimeout(r, 1000));

    // Should have received initial hash
    expect(receivedHashes.length).toBeGreaterThanOrEqual(1);
    expect(receivedHashes[receivedHashes.length - 1]).toBe(toHex(initialHash));

    // Publish update
    await resolver.publish!(key, updatedHash);

    // Wait for update
    await new Promise(r => setTimeout(r, 1500));

    // Should have received updated hash
    expect(receivedHashes.length).toBeGreaterThanOrEqual(2);
    expect(receivedHashes[receivedHashes.length - 1]).toBe(toHex(updatedHash));

    unsubscribe();
    resolver.stop?.();
  }, 10000);

  it('should list and receive tree list updates', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    const treeName = `list-update-test-${Date.now()}`;
    const hash = fromHex('cccc'.repeat(16));

    // Subscribe to list
    let lastEntries: Array<{ key: string; hash: Uint8Array }> = [];
    const unsubscribe = resolver.list!(npub, (entries) => {
      lastEntries = entries;
    });

    // Wait for initial list
    await new Promise(r => setTimeout(r, 1000));

    const initialCount = lastEntries.length;

    // Publish new tree
    await resolver.publish!(`${npub}/${treeName}`, hash);

    // Wait for update
    await new Promise(r => setTimeout(r, 1500));

    // Should have one more tree
    expect(lastEntries.length).toBe(initialCount + 1);
    expect(lastEntries.some(e => e.key.includes(treeName))).toBe(true);

    unsubscribe();
    resolver.stop?.();
  }, 10000);

  it('should handle invalid keys gracefully', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    // Invalid npub
    const result1 = await resolver.resolve('invalid-key');
    expect(result1).toBeNull();

    // Missing tree name
    const result2 = await resolver.resolve(npub);
    expect(result2).toBeNull();

    // Invalid npub format
    const result3 = await resolver.resolve('npub1invalid/tree');
    expect(result3).toBeNull();

    resolver.stop?.();
  });

  it('should only keep latest event per tree', async () => {
    const { subscribe, publish } = createNostrFunctions(ndk);
    const resolver = createNostrRefResolver({
      subscribe,
      publish,
      getPubkey: () => pubkey,
      nip19,
    });

    const treeName = `latest-test-${Date.now()}`;
    const key = `${npub}/${treeName}`;

    // Publish multiple updates with longer delays to ensure distinct timestamps
    // (Nostr uses second-precision timestamps)
    const hash1 = fromHex('1111'.repeat(16));
    const hash2 = fromHex('2222'.repeat(16));
    const hash3 = fromHex('3333'.repeat(16));

    await resolver.publish!(key, hash1);
    await new Promise(r => setTimeout(r, 1100)); // Wait >1s for next timestamp
    await resolver.publish!(key, hash2);
    await new Promise(r => setTimeout(r, 1100)); // Wait >1s for next timestamp
    await resolver.publish!(key, hash3);

    // Wait for relay
    await new Promise(r => setTimeout(r, 1000));

    // Should resolve to latest
    const resolved = await resolver.resolve(key);
    expect(resolved).not.toBeNull();
    expect(toHex(resolved!)).toBe(toHex(hash3));

    resolver.stop?.();
  }, 10000);
});
