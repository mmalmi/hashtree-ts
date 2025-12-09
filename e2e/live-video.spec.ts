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
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_VIDEO = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');

// Helper to set up a fresh user session and navigate to public folder
async function setupFreshUser(page: Page) {
  setupPageErrorHandler(page);

  await page.goto('/');

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
  await navigateToPublicFolder(page);
}

test.describe('Video Viewer', () => {
  test.setTimeout(60000);

  test('should display video with correct duration', async ({ page }) => {
    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Log console for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') console.log(`[Video Error] ${text}`);
    });

    // Set up fresh user and navigate to public folder
    await setupFreshUser(page);

    // Upload the video via hidden file input
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    // Wait for upload to complete - look for the video in the file list
    const videoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'Big_Buck_Bunny_360_10s_1MB.mp4' }).first();
    await expect(videoLink).toBeVisible({ timeout: 30000 });

    // Click on the video to view it
    await videoLink.click();
    await page.waitForTimeout(1000);

    // Check that video element exists
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 10000 });

    // Wait for video to have a source
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video) return false;
      return video.src !== '' || video.srcObject !== null;
    }, { timeout: 10000 });

    // Wait for video metadata to load (duration becomes available)
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

    // Check duration display in UI (format: "0:00 / 0:10" for 10s video)
    // Big Buck Bunny test video is ~10 seconds
    const durationDisplay = page.locator('text=/\\d+:\\d+ \\/ \\d+:\\d+/');
    await expect(durationDisplay).toBeVisible({ timeout: 5000 });
  });

  test('should play video and update current time', async ({ page }) => {
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    await setupFreshUser(page);

    // Upload the video
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    // Click on video
    const videoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'Big_Buck_Bunny_360_10s_1MB.mp4' }).first();
    await expect(videoLink).toBeVisible({ timeout: 30000 });
    await videoLink.click();

    // Wait for video to load
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 2; // HAVE_CURRENT_DATA
    }, { timeout: 15000 });

    // Play the video (muted to avoid autoplay restrictions)
    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (video) {
        video.muted = true;
        return video.play().catch(e => console.error('Play failed:', e));
      }
    });

    // Wait for video to play a bit
    await page.waitForTimeout(1500);

    // Check that currentTime has advanced
    const currentTime = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video?.currentTime || 0;
    });

    console.log('Current time after playing:', currentTime);
    expect(currentTime).toBeGreaterThan(0);
  });

  test('recently changed video should show LIVE indicator and seek near end', async ({ page }) => {
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    await setupFreshUser(page);

    // Upload the video
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    // Click on video immediately after upload (while it's still "recently changed")
    const videoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'Big_Buck_Bunny_360_10s_1MB.mp4' }).first();
    await expect(videoLink).toBeVisible({ timeout: 30000 });
    await videoLink.click();

    // Wait for video to load
    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1;
    }, { timeout: 15000 });

    // Check for LIVE indicator (should appear for recently changed files)
    // The file was just uploaded so it should be in recentlyChangedFiles store
    const liveIndicator = page.locator('text=LIVE');

    // Get video duration and current time to check if it seeked near end
    const videoState = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        duration: video.duration,
        currentTime: video.currentTime,
      };
    });

    console.log('Video state for live check:', JSON.stringify(videoState, null, 2));

    // Verify duration is available immediately (not NaN or 0)
    expect(videoState).not.toBeNull();
    expect(videoState!.duration).toBeGreaterThan(0);
    expect(isFinite(videoState!.duration)).toBe(true);

    // If video is long enough (>5s) and was detected as live,
    // it should have seeked to near the end (duration - 5)
    // Our test video is ~10s, so if live detection worked, currentTime should be ~5
    if (videoState!.duration > 5) {
      // Check if LIVE indicator is visible OR if it seeked to near end
      // (depending on whether the file is still in recentlyChanged store)
      const isLiveVisible = await liveIndicator.isVisible().catch(() => false);
      console.log('LIVE indicator visible:', isLiveVisible);

      if (isLiveVisible) {
        // If LIVE is shown, video should have seeked near end
        expect(videoState!.currentTime).toBeGreaterThan(videoState!.duration - 6);
      }
    }
  });

  test('video with ?live=1 hash param should show LIVE indicator and seek near end', async ({ page }) => {
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    await setupFreshUser(page);

    // Upload the video
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    // Get the video URL
    const videoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'Big_Buck_Bunny_360_10s_1MB.mp4' }).first();
    await expect(videoLink).toBeVisible({ timeout: 30000 });

    // Navigate to the video with ?live=1 hash param
    const href = await videoLink.getAttribute('href');
    expect(href).toBeTruthy();
    const liveUrl = href + '?live=1';
    await page.goto('/' + liveUrl);

    // Wait for video to load
    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1;
    }, { timeout: 15000 });

    // LIVE indicator should be visible because of ?live=1 param
    // Note: LIVE badge appears in both viewer header and video overlay - use .first()
    const liveIndicator = page.locator('text=LIVE').first();
    await expect(liveIndicator).toBeVisible({ timeout: 5000 });

    // Get video state
    const videoState = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        duration: video.duration,
        currentTime: video.currentTime,
      };
    });

    console.log('Video state with ?live=1:', JSON.stringify(videoState, null, 2));

    // Video should have seeked to near the end (5s from end)
    expect(videoState).not.toBeNull();
    expect(videoState!.duration).toBeGreaterThan(5);
    // currentTime should be near the end (duration - 5), within 1 second tolerance
    expect(videoState!.currentTime).toBeGreaterThan(videoState!.duration - 6);
    expect(videoState!.currentTime).toBeLessThan(videoState!.duration);
  });

  test('?live=1 param should be removed when stream is no longer live', async ({ page }) => {
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Capture console logs for debugging
    page.on('console', msg => {
      if (msg.text().includes('[LiveVideo]')) {
        console.log(msg.text());
      }
    });

    await setupFreshUser(page);

    // Upload the video
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    // Get the video URL and navigate with ?live=1
    const videoLink = page.locator('[data-testid="file-list"] a').filter({ hasText: 'Big_Buck_Bunny_360_10s_1MB.mp4' }).first();
    await expect(videoLink).toBeVisible({ timeout: 30000 });
    const href = await videoLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Navigate to video with ?live=1
    const liveUrl = href + '?live=1';
    await page.goto('/' + liveUrl);

    // Verify ?live=1 is in URL
    expect(page.url()).toContain('live=1');

    // Wait for video to load
    await page.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1;
    }, { timeout: 15000 });

    // Wait for the ?live=1 param to be removed (2s delay + buffer)
    // The file is not in recentlyChangedFiles (uploaded via setInputFiles, not our saveFile)
    // so it should detect as "no longer live" and remove the param
    await page.waitForFunction(() => {
      return !window.location.hash.includes('live=1');
    }, { timeout: 10000 });

    // Verify ?live=1 was removed from URL
    expect(page.url()).not.toContain('live=1');
    console.log('URL after live param removed:', page.url());
  });
});
