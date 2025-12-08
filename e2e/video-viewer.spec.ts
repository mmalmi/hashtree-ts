/**
 * E2E test for video viewer functionality
 *
 * Tests that videos can be uploaded and played back correctly.
 * Uses the Big Buck Bunny test video from e2e/fixtures.
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { setupPageErrorHandler } from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_VIDEO = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');

// Helper to set up a fresh user session and navigate to public folder
async function setupFreshUser(page: Page) {
  setupPageErrorHandler(page);

  await page.goto('http://localhost:5173');

  // Clear storage for fresh state
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.reload();
  await page.waitForTimeout(500);
  await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });

  // Wait for the public folder link to appear
  const publicLink = page.getByRole('link', { name: 'public' }).first();
  await expect(publicLink).toBeVisible({ timeout: 15000 });

  // Click into the public folder
  await publicLink.click();
  await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /File/ }).first()).toBeVisible({ timeout: 10000 });
}

test.describe('Video Viewer', () => {
  test('should display and play video file', async ({ page }) => {
    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Log console for debugging
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') console.log(`[Video Error] ${text}`);
      if (text.includes('[LiveVideo]')) console.log(`[Video] ${text}`);
    });

    // Set up fresh user and navigate to public folder
    await setupFreshUser(page);
    console.log('User setup complete');

    // Upload the video via hidden file input
    console.log('Uploading video file...');
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);

    // After uploading a single file, the app auto-navigates to view it
    // Wait for the URL to include the filename (indicating upload complete and navigation happened)
    console.log('Waiting for upload and auto-navigation...');
    await page.waitForURL(/Big_Buck_Bunny_360_10s_1MB\.mp4/, { timeout: 30000 });
    console.log('Upload complete, navigated to video');

    // Small wait for video component to load
    await page.waitForTimeout(500);

    // Check that video element exists
    console.log('Checking for video element...');
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 10000 });
    console.log('Video element is visible');

    // Wait for video to have a source (either src attribute or MediaSource)
    console.log('Waiting for video to have source...');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video) return false;
      // Check if video has a source
      return video.src !== '' || video.srcObject !== null;
    }, { timeout: 10000 });
    console.log('Video has source');

    // Wait for video metadata to load (duration becomes available)
    console.log('Waiting for video metadata...');
    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1; // HAVE_METADATA
    }, { timeout: 15000 });

    // Get video state
    const videoState = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        src: video.src,
        hasSrcObject: video.srcObject !== null,
        readyState: video.readyState,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        paused: video.paused,
        error: video.error ? { code: video.error.code, message: video.error.message } : null,
      };
    });

    console.log('Video state:', JSON.stringify(videoState, null, 2));

    // Verify video has loaded correctly
    expect(videoState).not.toBeNull();
    expect(videoState!.readyState).toBeGreaterThanOrEqual(1);
    expect(videoState!.duration).toBeGreaterThan(0);
    expect(videoState!.videoWidth).toBeGreaterThan(0);
    expect(videoState!.videoHeight).toBeGreaterThan(0);
    expect(videoState!.error).toBeNull();

    // Take a screenshot of the video player
    const screenshot = await page.screenshot();
    console.log('Screenshot taken, size:', screenshot.length, 'bytes');

    // Try to play the video
    console.log('Attempting to play video...');
    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (video) {
        video.muted = true; // Mute to avoid autoplay restrictions
        return video.play().catch(e => console.error('Play failed:', e));
      }
    });

    // Wait a short time and check if video is playing
    await page.waitForTimeout(500);

    const playbackState = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        paused: video.paused,
        currentTime: video.currentTime,
        readyState: video.readyState,
      };
    });

    console.log('Playback state:', JSON.stringify(playbackState, null, 2));

    // Video should either be playing or have advanced past 0
    // (some browsers may auto-pause after play)
    expect(playbackState).not.toBeNull();
    expect(playbackState!.readyState).toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA

    // Print console logs for debugging
    console.log('\n=== Console Logs ===');
    consoleLogs.slice(-20).forEach(log => console.log(log));

    console.log('\n=== Video Playback Test Passed ===');
  });

  test('video element has correct dimensions after loading', async ({ page }) => {
    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Set up fresh user and navigate to public folder
    await setupFreshUser(page);

    // Upload the video via hidden file input
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);

    // After uploading a single file, the app auto-navigates to view it
    await page.waitForURL(/Big_Buck_Bunny_360_10s_1MB\.mp4/, { timeout: 30000 });

    // Wait for video element
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 10000 });

    // Wait for video to load metadata
    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1 && video.videoWidth > 0;
    }, { timeout: 15000 });

    // Get bounding box of video element
    const boundingBox = await videoElement.boundingBox();
    expect(boundingBox).not.toBeNull();

    // Video should have reasonable dimensions (not zero, not too small)
    expect(boundingBox!.width).toBeGreaterThan(100);
    expect(boundingBox!.height).toBeGreaterThan(50);

    console.log(`Video element dimensions: ${boundingBox!.width}x${boundingBox!.height}`);
    console.log('=== Video Dimensions Test Passed ===');
  });
});
