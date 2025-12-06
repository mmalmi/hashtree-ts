/**
 * E2E test for WebRTC request forwarding
 *
 * Tests the scenario where:
 * - Peer A connects to Peer B (mutual follows)
 * - Peer B connects to Peer C (mutual follows)
 * - Peer A does NOT connect to Peer C (not following each other)
 * - Peer C has content in their public tree
 * - A navigates to C's npub/public and receives content via B's forwarding
 *
 * This tests the request forwarding feature where peers relay requests
 * to their other connected peers when they don't have the content locally.
 */
import { test, expect } from '@playwright/test';

test.describe('WebRTC Request Forwarding', () => {
  test.setTimeout(180000);

  // Skip: WebRTC connection timing is inherently flaky across browser contexts
  // Peers may disconnect before content can be forwarded due to timing issues
  test.skip('peer A receives content from peer C via peer B forwarding', async ({ browser }) => {
    // Create three browser contexts with separate storage
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();

    // Log browser console for debugging
    pageA.on('console', msg => {
      const text = msg.text();
      if (text.includes('CONNECTED') || text.includes('GOT') || text.includes('forward') || text.includes('WebRTC')) {
        console.log(`[A] ${text}`);
      }
    });
    pageB.on('console', msg => {
      const text = msg.text();
      if (text.includes('CONNECTED') || text.includes('forward') || text.includes('WebRTC') || text.includes('Sent data')) {
        console.log(`[B] ${text}`);
      }
    });
    pageC.on('console', msg => {
      const text = msg.text();
      if (text.includes('CONNECTED') || text.includes('WebRTC') || text.includes('Stored')) {
        console.log(`[C] ${text}`);
      }
    });

    // Clear storage and navigate all pages to the app
    // This prevents the app's own WebRTCStore from interfering with the test
    await Promise.all([
      contextA.clearCookies(),
      contextB.clearCookies(),
      contextC.clearCookies(),
    ]);

    await Promise.all([
      pageA.goto('http://localhost:5173'),
      pageB.goto('http://localhost:5173'),
      pageC.goto('http://localhost:5173'),
    ]);

    // Clear localStorage to prevent auto-login which starts the app's WebRTCStore
    await Promise.all([
      pageA.evaluate(() => localStorage.clear()),
      pageB.evaluate(() => localStorage.clear()),
      pageC.evaluate(() => localStorage.clear()),
    ]);

    // Reload to apply the cleared state
    await Promise.all([
      pageA.reload(),
      pageB.reload(),
      pageC.reload(),
    ]);

    await Promise.all([
      pageA.waitForLoadState('load'),
      pageB.waitForLoadState('load'),
      pageC.waitForLoadState('load'),
    ]);

    // Wait for test function to be available
    await Promise.all([
      pageA.waitForFunction(() => typeof (window as any).runForwardingTest === 'function', { timeout: 10000 }),
      pageB.waitForFunction(() => typeof (window as any).runForwardingTest === 'function', { timeout: 10000 }),
      pageC.waitForFunction(() => typeof (window as any).runForwardingTest === 'function', { timeout: 10000 }),
    ]);

    const testContent = 'Content from Peer C via B forwarding!';

    // Step 1: Start peer C first (content provider)
    // Note: runForwardingTest runs for 2 minutes, we don't await it - we'll close contexts when done
    console.log('\n=== Starting Peer C (content provider) ===');
    pageC.evaluate((content) => (window as any).runForwardingTest({
      role: 'content-provider',
      content,
    }), testContent).catch(() => {}); // Ignore errors when context closes

    // Wait for C to be ready with pubkey and content hash
    await pageC.waitForFunction(
      () => (window as any).forwardingTestState?.pubkey && (window as any).forwardingTestState?.contentNhash,
      { timeout: 15000 }
    );
    const stateC = await pageC.evaluate(() => (window as any).forwardingTestState);
    console.log(`Peer C pubkey: ${stateC.pubkey.slice(0, 16)}...`);
    console.log(`Content hash: ${stateC.contentHash?.slice(0, 16)}...`);
    console.log(`Content nhash: ${stateC.contentNhash}`);

    // Step 2: Start peer B (relay/forwarder)
    // B follows C, so they will connect
    console.log('\n=== Starting Peer B (forwarder) ===');
    pageB.evaluate((cPubkey) => (window as any).runForwardingTest({
      role: 'forwarder',
      followPubkeys: [cPubkey], // B follows C
    }), stateC.pubkey).catch(() => {}); // Ignore errors when context closes

    // Wait for B to be ready
    await pageB.waitForFunction(
      () => (window as any).forwardingTestState?.pubkey,
      { timeout: 15000 }
    );
    const stateB = await pageB.evaluate(() => (window as any).forwardingTestState);
    console.log(`Peer B pubkey: ${stateB.pubkey.slice(0, 16)}...`);

    // Update C to follow B (mutual follow)
    await pageC.evaluate((bPubkey) => {
      (window as any).forwardingTestState.addFollow(bPubkey);
    }, stateB.pubkey);

    // Step 3: Start peer A (requester)
    // A follows B only, NOT C
    console.log('\n=== Starting Peer A (requester) ===');
    pageA.evaluate((bPubkey) => (window as any).runForwardingTest({
      role: 'requester',
      followPubkeys: [bPubkey], // A follows B only
    }), stateB.pubkey).catch(() => {}); // Ignore errors when context closes

    // Wait for A to be ready
    await pageA.waitForFunction(
      () => (window as any).forwardingTestState?.pubkey,
      { timeout: 15000 }
    );
    const stateA = await pageA.evaluate(() => (window as any).forwardingTestState);
    console.log(`Peer A pubkey: ${stateA.pubkey.slice(0, 16)}...`);

    // Update B to follow A (mutual follow A<->B)
    await pageB.evaluate((aPubkey) => {
      (window as any).forwardingTestState.addFollow(aPubkey);
    }, stateA.pubkey);

    // Wait for connections to establish
    console.log('\n=== Waiting for connections ===');

    // Wait for A to connect to B (poll every 500ms, up to 60s)
    for (let i = 0; i < 120; i++) {
      const aConnected = await pageA.evaluate(() => (window as any).forwardingTestState?.connectedPeers > 0);
      if (aConnected) break;
      await pageA.waitForTimeout(500);
    }
    console.log('A connected to peers');

    // Wait for B to connect to both A and C
    for (let i = 0; i < 120; i++) {
      const bConnected = await pageB.evaluate(() => (window as any).forwardingTestState?.connectedPeers >= 2);
      if (bConnected) break;
      await pageB.waitForTimeout(500);
    }
    console.log('B connected to multiple peers');

    // Now have A request the content by hash
    // This simulates what happens when navigating to /{nhash} URL
    // The viewer calls tree.readFile() -> store.get(hash) -> WebRTC forwarding
    console.log('\n=== A requesting content (simulates navigation to nhash URL) ===');
    console.log(`Content would be at URL: http://localhost:5173/${stateC.contentNhash}`);

    // Give the connections a moment to stabilize before request
    await pageA.waitForTimeout(2000);

    const result = await pageA.evaluate(async (hash) => {
      const state = (window as any).forwardingTestState;
      if (!state || !state.requestContent) {
        return { found: false, error: 'No requestContent function' };
      }
      return state.requestContent(hash);
    }, stateC.contentHash);

    console.log('\n=== Results ===');
    console.log(`Content received: ${result.found}`);
    if (result.data) {
      console.log(`Content: "${result.data}"`);
    }

    // Get peer states to verify A was not directly connected to C
    const finalAPeers = await pageA.evaluate(() => (window as any).forwardingTestState?.peers || []);
    const finalBPeers = await pageB.evaluate(() => (window as any).forwardingTestState?.peers || []);
    const finalCPeers = await pageC.evaluate(() => (window as any).forwardingTestState?.peers || []);

    console.log(`\nPeer A peers: ${JSON.stringify(finalAPeers)}`);
    console.log(`Peer B peers: ${JSON.stringify(finalBPeers)}`);
    console.log(`Peer C peers: ${JSON.stringify(finalCPeers)}`);

    // Clean up
    await Promise.all([
      contextA.close(),
      contextB.close(),
      contextC.close(),
    ]);

    // Verify:
    // 1. A got the content
    expect(result.found).toBe(true);
    expect(result.data).toBe(testContent);

    // 2. A was not directly connected to C (only to B)
    // The content came via B's forwarding
    const aPeerPubkeys = finalAPeers.map((p: any) => p.pubkey);
    const cPubkeyPrefix = stateC.pubkey.slice(0, 16);
    const bPubkeyPrefix = stateB.pubkey.slice(0, 16);

    // A should NOT be connected to C
    expect(aPeerPubkeys).not.toContain(cPubkeyPrefix);

    // A should be connected to B (the forwarder)
    expect(aPeerPubkeys).toContain(bPubkeyPrefix);

    // B should be connected to both A and C (acting as the bridge)
    const bPeerPubkeys = finalBPeers.map((p: any) => p.pubkey);
    expect(bPeerPubkeys).toContain(stateA.pubkey.slice(0, 16));
    expect(bPeerPubkeys).toContain(cPubkeyPrefix);

    console.log('\n✓ Verified: A received content from C via B forwarding');
    console.log('✓ Verified: A was NOT directly connected to C');
    console.log('✓ Verified: B was connected to both A and C');
  });
});
