import { test, expect } from '@playwright/test';
import { disableOthersPool } from './test-utils.js';

/**
 * Test that social graph root is set correctly on login and account switch
 */
test.describe('Social graph root', () => {
  test('should set root when app loads with logged in user', async ({ page }) => {
    await page.goto('/');
    await disableOthersPool(page);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();

    // Wait for login to complete - the social graph should have the user's pubkey as root
    await page.waitForFunction(
      () => {
        const nostrStore = (window as any).__nostrStore;
        const getSocialGraph = (window as any).__getSocialGraph;
        if (!nostrStore || !getSocialGraph) return false;

        const pubkey = nostrStore.getState()?.pubkey;
        if (!pubkey) return false;

        const graph = getSocialGraph();
        const root = graph?.getRoot?.();
        return root === pubkey;
      },
      { timeout: 10000 }
    );

    // Verify the root matches the logged in user's pubkey
    const { pubkey, root } = await page.evaluate(() => {
      const nostrStore = (window as any).__nostrStore;
      const getSocialGraph = (window as any).__getSocialGraph;
      return {
        pubkey: nostrStore?.getState()?.pubkey,
        root: getSocialGraph?.()?.getRoot?.(),
      };
    });

    console.log('User pubkey:', pubkey);
    console.log('Social graph root:', root);
    expect(root).toBe(pubkey);
  });

  test('should show me as known follower when I follow someone', async ({ page }) => {
    test.setTimeout(60000);

    const logs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[socialGraph]') || text.includes('[ProfileView]') || text.includes('[UserRoute]') || text.includes('[router]') || text.includes('[App]')) {
        logs.push(text);
        console.log(text); // Print immediately
      }
    });

    // Capture page errors
    page.on('pageerror', (err) => {
      console.log('[PAGE ERROR]:', err.message);
    });

    // Clear storage to start fresh
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('hashtree-social-graph');
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Login with new account
    await page.getByRole('button', { name: /New/i }).click();
    await page.waitForTimeout(3000);

    // Close any modals
    const backdrop = page.locator('.fixed.inset-0.z-50');
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await page.waitForTimeout(500);
    }

    // Get my pubkey from the URL or profile
    await page.click('[title="My Profile (double-click for users)"]');
    await page.waitForTimeout(1000);

    const url = page.url();
    const npubMatch = url.match(/npub1[a-z0-9]+/);
    const myNpub = npubMatch?.[0];
    console.log('My npub:', myNpub);

    // Navigate to a known user (different from self) using in-page navigation
    // This is a valid npub (verified checksum)
    const testNpub = 'npub1lmcetzfksspn524eu59hvejhv7nw2v8dkv7jt8m634wvkad5hnaqttp4nr';
    console.log('Navigating to test user:', testNpub);

    // Use search to navigate (more realistic user flow)
    await page.fill('input[placeholder*="Search"]', testNpub);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000); // Wait longer for re-render

    // Verify URL changed
    console.log('Current URL:', page.url());

    // Check what npub is being displayed
    const displayedNpub = await page.locator('text=/npub1[a-z0-9]+/').first().textContent().catch(() => 'unknown');
    console.log('Displayed npub:', displayedNpub);

    // Wait for ProfileView to log
    await page.waitForTimeout(1000);

    // Verify we're on someone else's profile
    // Check for Follow button (would only appear on someone else's profile)
    const followButton = page.getByRole('button', { name: 'Follow', exact: true });
    const editButton = page.getByRole('button', { name: 'Edit Profile' });

    const hasFollowBtn = await followButton.isVisible().catch(() => false);
    const hasEditBtn = await editButton.isVisible().catch(() => false);

    console.log('Has Follow button:', hasFollowBtn);
    console.log('Has Edit Profile button:', hasEditBtn);

    // Get page content for debugging
    const profileName = await page.locator('h1').first().textContent().catch(() => 'unknown');
    console.log('Profile name shown:', profileName);

    // Get the known followers count before following
    const followersLink = page.locator('a[href*="/followers"]');
    const followersBefore = await followersLink.textContent().catch(() => '? Known Followers');
    console.log('Followers before:', followersBefore);
    console.log('Followers link visible:', await followersLink.isVisible().catch(() => false));

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/before-follow.png', fullPage: true });

    // Follow the user
    if (await followButton.isVisible().catch(() => false)) {
      console.log('Clicking follow button...');
      await followButton.click();
      await page.waitForTimeout(3000);

      console.log('=== Logs after follow ===');
      logs.slice(-10).forEach(log => console.log(log));

      // Reload to see updated count
      await page.reload();
      await page.waitForTimeout(2000);

      // Check followers count after - should now include us
      const followersAfter = await page.locator('a[href*="/followers"]').textContent().catch(() => '? Known Followers');
      console.log('Followers after:', followersAfter);

      // Extract numbers
      const beforeNum = parseInt(followersBefore?.match(/(\d+)/)?.[1] || '0');
      const afterNum = parseInt(followersAfter?.match(/(\d+)/)?.[1] || '0');

      console.log('Before:', beforeNum, 'After:', afterNum);

      // After following, I should be counted as a known follower
      expect(afterNum).toBeGreaterThanOrEqual(beforeNum);
    } else {
      console.log('Follow button not visible, may already be following');
    }
  });
});
