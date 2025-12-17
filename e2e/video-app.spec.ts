import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Helper to ensure user is logged in
 */
async function ensureLoggedIn(page: any) {
  // Check if already logged in (Upload button visible)
  const uploadBtn = page.locator('button:has-text("Create")');
  const isVisible = await uploadBtn.isVisible().catch(() => false);

  if (!isVisible) {
    // Need to login - try clicking New button
    const newBtn = page.getByRole('button', { name: /New/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    }
  }
}

/**
 * Tests for video.iris.to (Iris Video app)
 * Tests video upload, playback, and navigation
 */
test.describe('Iris Video App', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('shows Iris Video header and home page', async ({ page }) => {
    await page.goto('/video.html#/');

    // Should show the Iris Video header
    await expect(page.locator('text=Iris Video')).toBeVisible({ timeout: 30000 });

    // Take screenshot of home page
    await page.screenshot({ path: 'e2e/screenshots/video-home.png' });
  });

  test('can open upload modal', async ({ page }) => {
    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Wait for Upload button
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });

    // Close any open modal first (press Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Click Upload button to open modal
    await uploadBtn.click();

    // Modal should appear with "Upload Video" heading
    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    // Should have file selection prompt
    await expect(page.locator('text=Click to select a video file')).toBeVisible();

    // Take screenshot of upload modal
    await page.screenshot({ path: 'e2e/screenshots/video-upload-modal.png' });
  });

  test('can upload video and navigate to video page', async ({ page }) => {
    test.slow(); // Video processing can take time

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Wait for Upload button
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });

    // Close any modal and click Upload
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    // Wait for modal
    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    // Upload the test video file
    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testVideoPath);

    // Should show file info and title field
    await expect(page.locator('text=Big_Buck_Bunny_360_10s_1MB.mp4')).toBeVisible({ timeout: 10000 });

    // Title should be pre-filled from filename
    const titleInput = page.locator('input[placeholder="Video title"]');
    await expect(titleInput).toHaveValue('Big_Buck_Bunny_360_10s_1MB', { timeout: 5000 });

    // Take screenshot of upload modal with file selected
    await page.screenshot({ path: 'e2e/screenshots/video-upload-file-selected.png' });

    // Change title to something unique
    const videoTitle = `Test Video ${Date.now()}`;
    await titleInput.fill(videoTitle);

    // Click Upload button in modal
    await page.locator('.fixed button:has-text("Upload")').click();

    // Should show progress
    await expect(page.locator('text=Processing...').or(page.locator('text=Preparing'))).toBeVisible({ timeout: 5000 });

    // Wait for upload to complete and navigate to video page
    // URL should contain videos/ prefix
    await page.waitForURL(/\/video\.html#\/npub.*\/videos\//, { timeout: 60000 });

    // Modal should auto-close after navigation
    await expect(page.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    // Take screenshot of video player page
    await page.screenshot({ path: 'e2e/screenshots/video-player-page.png' });

    // Verify video title is shown (this confirms we're on the right page)
    await expect(page.locator(`text=${videoTitle}`)).toBeVisible({ timeout: 10000 });

    // Wait for video to load (may take time for tree root to sync)
    const videoLocator = page.locator('video');
    await expect(videoLocator).toBeVisible({ timeout: 60000 });

    // Wait for video to actually load metadata and have duration
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && video.readyState >= 1 && video.duration > 0;
    }, { timeout: 30000 });

    // Verify video properties are valid
    const videoProps = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      return {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        src: video.src?.substring(0, 100),
        error: video.error?.message
      };
    });

    // Video should have valid properties (Big Buck Bunny is ~10 seconds)
    expect(videoProps).not.toBeNull();
    expect(videoProps!.duration).toBeGreaterThan(5);
    expect(videoProps!.videoWidth).toBeGreaterThan(0);
    expect(videoProps!.videoHeight).toBeGreaterThan(0);
    expect(videoProps!.error).toBeUndefined();

    // Take final screenshot
    await page.screenshot({ path: 'e2e/screenshots/video-player-loaded.png' });
  });

  test('can delete uploaded video', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Upload a video first
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testVideoPath);

    const videoTitle = `Delete Test ${Date.now()}`;
    const titleInput = page.locator('input[placeholder="Video title"]');
    await titleInput.fill(videoTitle);

    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for navigation to video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos\//, { timeout: 60000 });

    // Verify we're on the video page
    await expect(page.locator(`text=${videoTitle}`)).toBeVisible({ timeout: 10000 });

    // Click delete button
    page.on('dialog', dialog => dialog.accept()); // Accept the confirm dialog
    const deleteBtn = page.locator('button[title="Delete video"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // Should navigate back to home
    await page.waitForURL('/video.html#/', { timeout: 10000 });

    // Video should no longer appear in list
    await expect(page.locator(`text=${videoTitle}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('profile page shows uploaded videos', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });

    // Get the user's npub
    const npub = await page.evaluate(() => (window as any).__nostrStore?.getState()?.npub);
    expect(npub).toBeTruthy();

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"]').setInputFiles(testVideoPath);

    const videoTitle = `Profile Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos\//, { timeout: 60000 });

    // Modal should auto-close
    await expect(page.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });

    // Navigate to profile page
    await page.evaluate((n) => window.location.hash = `#/${n}`, npub);

    // Wait for profile to load - look for "video" count text
    await expect(page.locator('text=video').first()).toBeVisible({ timeout: 30000 });

    // Take screenshot of profile page
    await page.screenshot({ path: 'e2e/screenshots/video-profile-page.png' });

    // Video should appear on profile
    await expect(page.locator(`text=${videoTitle}`)).toBeVisible({ timeout: 30000 });
  });

  test('can post a comment on a video', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"]').setInputFiles(testVideoPath);

    const videoTitle = `Comment Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos\//, { timeout: 60000 });

    // Modal should auto-close
    await expect(page.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    // Wait for Comments heading to be visible
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible({ timeout: 30000 });

    // Find comment textarea and type a comment
    const commentBox = page.locator('textarea[placeholder="Add a comment..."]');
    await expect(commentBox).toBeVisible({ timeout: 10000 });

    const commentText = `Test comment ${Date.now()}`;
    await commentBox.fill(commentText);

    // Click Comment button
    await page.getByRole('button', { name: 'Comment' }).click();

    // Comment should appear in the list
    await expect(page.locator(`text=${commentText}`)).toBeVisible({ timeout: 30000 });

    // Take screenshot of video with comment
    await page.screenshot({ path: 'e2e/screenshots/video-with-comment.png' });
  });
});
