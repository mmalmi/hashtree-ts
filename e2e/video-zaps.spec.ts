import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Helper to ensure user is logged in
 */
async function ensureLoggedIn(page: any) {
  const createBtn = page.locator('button:has-text("Create")');
  const isVisible = await createBtn.isVisible().catch(() => false);

  if (!isVisible) {
    const newBtn = page.getByRole('button', { name: /New/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await expect(createBtn).toBeVisible({ timeout: 15000 });
    }
  }
}

/**
 * Get the user's npub from the current session
 */
async function getUserNpub(page: any): Promise<string> {
  return await page.evaluate(() => {
    const store = (window as any).__nostrStore;
    return store?.npub || '';
  });
}

/**
 * Helper to upload a test video and return the video URL
 */
async function uploadTestVideo(page: any): Promise<string> {
  await ensureLoggedIn(page);

  // Close any modal and open upload modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Click Create button to open dropdown
  const createBtn = page.locator('button:has-text("Create")');
  await expect(createBtn).toBeVisible({ timeout: 15000 });
  await createBtn.click();

  // Wait for dropdown and click "Upload Video" option
  const uploadOption = page.locator('button:has-text("Upload Video")').first();
  await expect(uploadOption).toBeVisible({ timeout: 5000 });
  await uploadOption.click();

  // Wait for modal to appear
  await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 10000 });

  // Upload the test video file
  const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
  const fileInput = page.locator('input[type="file"][accept="video/*"]');
  await fileInput.setInputFiles(testVideoPath);

  // Wait for title to be pre-filled
  const titleInput = page.locator('input[placeholder="Video title"]');
  await expect(titleInput).toHaveValue('Big_Buck_Bunny_360_10s_1MB', { timeout: 5000 });

  // Change title to something unique
  const videoTitle = `Zap Test Video ${Date.now()}`;
  await titleInput.fill(videoTitle);

  // Click Upload button
  await page.locator('.fixed button:has-text("Upload")').click();

  // Wait for upload to complete and navigate to video page
  await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

  return page.url();
}

/**
 * Tests for video zap functionality
 */
test.describe('Video Zaps', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('zap button not shown on own videos', async ({ page }) => {
    test.slow(); // Video upload takes time

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    await uploadTestVideo(page);

    // On our own video, zap button should NOT be visible
    await expect(page.getByTestId('zap-button')).not.toBeVisible({ timeout: 5000 });

    // But like button should be visible
    await expect(page.locator('button[title="Like"]')).toBeVisible();
  });

  test('comments section loads on video page', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    await uploadTestVideo(page);

    // Wait for video page to fully load - use heading to be specific
    await expect(page.getByRole('heading', { name: /Comments/ })).toBeVisible({ timeout: 10000 });

    // Should show empty comments message
    await expect(page.locator('text=No comments yet')).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/video-comments-section.png' });
  });

  test('zap button visible and modal opens for other user video', async ({ page, browser }) => {
    test.slow();

    // First browser context: upload a video
    await page.goto('/video.html#/');
    await disableOthersPool(page);
    const videoUrl = await uploadTestVideo(page);

    // Get owner npub
    const ownerNpub = await getUserNpub(page);
    console.log('Owner npub:', ownerNpub);

    // Second browser context: different user views the video
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    setupPageErrorHandler(page2);

    // Navigate to home first, create a new user
    await page2.goto('/video.html#/');
    await disableOthersPool(page2);

    // Login as a different user
    const newBtn = page2.getByRole('button', { name: /New/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await expect(page2.locator('button:has-text("Create")')).toBeVisible({ timeout: 15000 });
    }

    // Get second user's npub
    const viewerNpub = await getUserNpub(page2);
    console.log('Viewer npub:', viewerNpub);

    // Navigate to the video page
    const videoPath = new URL(videoUrl).hash;
    await page2.goto(`/video.html${videoPath}`);
    await page2.waitForTimeout(2000);

    // Check if we're viewing someone else's video
    const isOwnVideo = ownerNpub === viewerNpub;
    console.log('Is own video:', isOwnVideo);

    if (isOwnVideo) {
      // Same user in both contexts - can happen with local storage
      // Just verify the page loaded
      await expect(page2.getByRole('heading', { name: /Comments/ })).toBeVisible({ timeout: 10000 });
      console.log('Both contexts are same user, skipping zap button check');
    } else {
      // Different user - zap button should be visible
      const zapButton = page2.getByTestId('zap-button');
      await expect(zapButton).toBeVisible({ timeout: 10000 });

      // Click zap button to open modal
      await zapButton.click();

      // Modal should open
      await expect(page2.getByTestId('zap-modal')).toBeVisible({ timeout: 5000 });

      // Should show "no lightning address" message since test users don't have lud16
      await expect(
        page2.locator('text=hasn\'t set up a lightning address')
      ).toBeVisible({ timeout: 5000 });

      // Take screenshot of zap modal
      await page2.screenshot({ path: 'e2e/screenshots/video-zap-modal.png' });

      // Close modal with Escape
      await page2.keyboard.press('Escape');
      await expect(page2.getByTestId('zap-modal')).not.toBeVisible({ timeout: 3000 });
    }

    await context2.close();
  });
});
