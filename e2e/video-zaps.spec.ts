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

  test('zap button shows on own videos', async ({ page }) => {
    test.slow(); // Video upload takes time

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    await uploadTestVideo(page);

    // Zap button should be visible (disabled if no lud16, enabled if lud16 set)
    const zapButton = page.getByTestId('zap-button');
    await expect(zapButton).toBeVisible({ timeout: 5000 });

    // Test users don't have lud16, so button is disabled
    await expect(zapButton).toBeDisabled();

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

  test('zap button shows total on video page', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    await uploadTestVideo(page);

    // Zap button should be visible and show 0 (no zaps yet)
    const zapButton = page.getByTestId('zap-button');
    await expect(zapButton).toBeVisible({ timeout: 5000 });
    await expect(zapButton).toContainText('0');

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/video-zap-button.png' });
  });

  test('zap modal opens for user with lightning address', async ({ page }) => {
    test.slow();

    // Use a known npub that has lud16 set (sirius - has lightning address)
    // This tests that the zap modal opens when viewing videos from users with lud16
    const knownNpubWithLud16 = 'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk';

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Navigate to the known user's profile to find a video
    await page.goto(`/video.html#/${knownNpubWithLud16}`);
    await page.waitForTimeout(2000);

    // Find any video card and click it
    const videoCard = page.locator('a[href*="/videos/"]').first();
    const hasVideo = await videoCard.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasVideo) {
      console.log('No videos found for test user, skipping modal test');
      return;
    }

    await videoCard.click();
    await page.waitForTimeout(2000);

    // Zap button should be visible and enabled (user has lud16)
    const zapButton = page.getByTestId('zap-button');
    await expect(zapButton).toBeVisible({ timeout: 10000 });

    const isDisabled = await zapButton.isDisabled();
    console.log('Zap button disabled:', isDisabled);

    if (isDisabled) {
      console.log('Button is disabled - profile may not have loaded lud16 yet');
      await page.waitForTimeout(3000);
    }

    // Click zap button
    await zapButton.click();

    // Modal should open
    await expect(page.getByTestId('zap-modal')).toBeVisible({ timeout: 5000 });

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/video-zap-modal.png' });
  });
});
