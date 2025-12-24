import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Helper to ensure user is logged in
 */
async function ensureLoggedIn(page: any) {
  // Check if already logged in (Create button visible)
  const createBtn = page.locator('button:has-text("Create")');
  const isVisible = await createBtn.isVisible().catch(() => false);

  if (!isVisible) {
    // Need to login - try clicking New button
    const newBtn = page.getByRole('button', { name: /New/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await expect(createBtn).toBeVisible({ timeout: 15000 });
    }
  }
}

/**
 * Helper to open the video upload modal
 * The Create button opens a dropdown with options - click "Upload Video" to open modal
 */
async function openUploadModal(page: any) {
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

  test('shows feed content for new user after uploading video', async ({ page }) => {
    test.slow(); // Video upload takes time

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Close any modal and open upload modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    // Upload the test video file
    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    const fileInput = page.locator('input[type="file"][accept="video/*"]');
    await fileInput.setInputFiles(testVideoPath);

    // Title should be pre-filled from filename
    const titleInput = page.locator('input[placeholder="Video title"]');
    await expect(titleInput).toHaveValue('Big_Buck_Bunny_360_10s_1MB', { timeout: 5000 });

    // Change title to something unique
    const videoTitle = `Feed Test Video ${Date.now()}`;
    await titleInput.fill(videoTitle);

    // Click Upload button
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for upload to complete
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

    // Navigate back to home
    await page.locator('a[href="#/"]').first().click();
    await page.waitForURL(/\/video\.html#\/$/, { timeout: 10000 });

    // Should show "Feed" section with our uploaded video
    await expect(page.locator('text=Feed')).toBeVisible({ timeout: 30000 });

    // Take screenshot of feed content
    await page.screenshot({ path: 'e2e/screenshots/video-feed-content.png' });
  });

  test('can open upload modal', async ({ page }) => {
    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Close any open modal first (press Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Open upload modal via dropdown
    await openUploadModal(page);

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

    // Close any modal and open upload modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    // Upload the test video file
    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    const fileInput = page.locator('input[type="file"][accept="video/*"]');
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
    // URL should contain videos%2F (encoded slash since treeName includes 'videos/')
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

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
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    const fileInput = page.locator('input[type="file"][accept="video/*"]');
    await fileInput.setInputFiles(testVideoPath);

    const videoTitle = `Delete Test ${Date.now()}`;
    const titleInput = page.locator('input[placeholder="Video title"]');
    await titleInput.fill(videoTitle);

    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for navigation to video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

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

    // Get the user's npub
    const npub = await page.evaluate(() => (window as any).__nostrStore?.getState()?.npub);
    expect(npub).toBeTruthy();

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(testVideoPath);

    const videoTitle = `Profile Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

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

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(testVideoPath);

    const videoTitle = `Comment Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

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

  test('can like a video', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(testVideoPath);

    const videoTitle = `Like Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

    // Modal should auto-close
    await expect(page.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    // Wait for video title in the main content area (h1 heading)
    await expect(page.locator('h1', { hasText: videoTitle })).toBeVisible({ timeout: 30000 });

    // Find and click the like button (heart icon)
    const likeBtn = page.locator('button[title="Like"]');
    await expect(likeBtn).toBeVisible({ timeout: 10000 });

    // Click like button
    await likeBtn.click();

    // Wait for like to register - button should change to "Liked" and show count
    await expect(page.locator('button[title="Liked"]')).toBeVisible({ timeout: 10000 });

    // Like count should show "1"
    await expect(page.locator('button[title="Liked"]').locator('text=1')).toBeVisible({ timeout: 5000 });

    // Take screenshot of liked video
    await page.screenshot({ path: 'e2e/screenshots/video-liked.png' });
  });

  test('permalink navigates to nhash URL and shows video', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Upload a video first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await openUploadModal(page);

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(testVideoPath);

    const videoTitle = `Permalink Test ${Date.now()}`;
    await page.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page (npub route)
    await page.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });

    // Modal should auto-close
    await expect(page.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    // Wait for video to load
    const videoLocator = page.locator('video');
    await expect(videoLocator).toBeVisible({ timeout: 60000 });

    // Wait for video to actually load metadata
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && video.readyState >= 1 && video.duration > 0;
    }, { timeout: 30000 });

    // Find the Permalink button and click it
    const permalinkBtn = page.locator('button[title="Permalink (content-addressed)"]');
    await expect(permalinkBtn).toBeVisible({ timeout: 10000 });
    await permalinkBtn.click();

    // URL should now contain nhash (content-addressed permalink)
    await page.waitForURL(/\/video\.html#\/nhash1/, { timeout: 10000 });

    // Take screenshot of permalink page
    await page.screenshot({ path: 'e2e/screenshots/video-permalink-page.png' });

    // Video should still be visible on permalink page
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });

    // Wait for video to load on permalink page
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

    expect(videoProps).not.toBeNull();
    expect(videoProps!.duration).toBeGreaterThan(5);
    expect(videoProps!.videoWidth).toBeGreaterThan(0);
    expect(videoProps!.videoHeight).toBeGreaterThan(0);
    expect(videoProps!.error).toBeUndefined();

    // Should show the permalink info box
    await expect(page.locator('text=content-addressed permalink')).toBeVisible({ timeout: 5000 });

    // Take final screenshot
    await page.screenshot({ path: 'e2e/screenshots/video-permalink-loaded.png' });
  });

  test('liked video appears in follower feed', async ({ browser }) => {
    test.slow(); // Multi-browser test with Nostr sync

    // Create two browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

    // === Setup page1 (uploader who will like their own video) ===
    await page1.goto('/video.html#/');
    await disableOthersPool(page1);

    // Login page1
    const newBtn1 = page1.getByRole('button', { name: /New/i });
    if (await newBtn1.isVisible().catch(() => false)) {
      await newBtn1.click();
      await expect(page1.locator('button:has-text("Create")')).toBeVisible({ timeout: 15000 });
    }

    // Upload a video on page1 (this will navigate to video page with npub in URL)
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(200);

    // Open upload modal via dropdown
    const createBtn1 = page1.locator('button:has-text("Create")');
    await expect(createBtn1).toBeVisible({ timeout: 15000 });
    await createBtn1.click();
    const uploadOption1 = page1.locator('button:has-text("Upload Video")').first();
    await expect(uploadOption1).toBeVisible({ timeout: 5000 });
    await uploadOption1.click();
    await expect(page1.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 10000 });

    const testVideoPath = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');
    await page1.locator('input[type="file"][accept="video/*"]').setInputFiles(testVideoPath);

    const videoTitle = `Social Feed Test ${Date.now()}`;
    await page1.locator('input[placeholder="Video title"]').fill(videoTitle);
    await page1.locator('.fixed button:has-text("Upload")').click();

    // Wait for video page (this URL will contain the npub)
    await page1.waitForURL(/\/video\.html#\/npub.*\/videos%2F/, { timeout: 60000 });
    await expect(page1.getByRole('heading', { name: 'Upload Video' })).not.toBeVisible({ timeout: 10000 });

    // Get page1's npub from the current URL
    const page1Url = page1.url();
    const page1NpubMatch = page1Url.match(/npub1[a-z0-9]+/);
    expect(page1NpubMatch).toBeTruthy();
    const page1Npub = page1NpubMatch![0];
    console.log(`Page1 npub: ${page1Npub.slice(0, 20)}...`);

    // Like the video
    const likeBtn = page1.locator('button[title="Like"]');
    await expect(likeBtn).toBeVisible({ timeout: 10000 });
    await likeBtn.click();
    await expect(page1.locator('button[title="Liked"]')).toBeVisible({ timeout: 10000 });
    console.log('Video uploaded and liked');

    // Wait for like to propagate to relays
    await page1.waitForTimeout(3000);

    // === Setup page2 (follower) ===
    await page2.goto('/video.html#/');
    await disableOthersPool(page2);

    // Login page2
    const newBtn2 = page2.getByRole('button', { name: /New/i });
    if (await newBtn2.isVisible().catch(() => false)) {
      await newBtn2.click();
      await expect(page2.locator('button:has-text("Create")')).toBeVisible({ timeout: 15000 });
    }

    // Page2 follows page1
    await page2.goto(`/video.html#/${page1Npub}`);
    const followBtn = page2.getByRole('button', { name: 'Follow', exact: true });
    await expect(followBtn).toBeVisible({ timeout: 30000 });
    await followBtn.click();
    console.log('Page2 now follows page1');

    // Wait for follow to propagate
    await page2.waitForTimeout(2000);

    // Go to home page and check feed
    await page2.goto('/video.html#/');

    // Wait for Feed section heading to appear
    await expect(page2.getByRole('heading', { name: 'Feed', exact: true })).toBeVisible({ timeout: 30000 });

    // The liked video should appear in page2's feed
    await expect(page2.locator(`text=${videoTitle}`)).toBeVisible({ timeout: 30000 });
    console.log('Liked video appears in follower feed!');

    // Take screenshot
    await page2.screenshot({ path: 'e2e/screenshots/video-social-feed.png' });

    // Cleanup
    await context1.close();
    await context2.close();
  });
});
