/**
 * E2E test for video direct navigation
 *
 * Tests that browser B can direct navigate to a video uploaded by browser A
 * and the video should load and play correctly.
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { setupPageErrorHandler, navigateToPublicFolder, disableOthersPool, configureBlossomServers } from './test-utils.js';
// Run tests in this file serially to avoid WebRTC/timing conflicts
test.describe.configure({ mode: 'serial' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_VIDEO = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s_1MB.mp4');

test.describe('Video Direct Navigation', () => {
  test.setTimeout(120000);

  test('browser B can direct navigate to video uploaded by browser A', async ({ browser }) => {
    test.slow(); // Multi-browser test with WebRTC sync

    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Create two browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    setupPageErrorHandler(page1);
    setupPageErrorHandler(page2);

    // Console logging for debugging
    page1.on('console', msg => {
      const text = msg.text();
      if (text.includes('WebRTC') || text.includes('error') || text.includes('Error')) {
        console.log(`[page1] ${text}`);
      }
    });
    page2.on('console', msg => {
      const text = msg.text();
      if (text.includes('WebRTC') || text.includes('error') || text.includes('Error') || text.includes('video')) {
        console.log(`[page2] ${text}`);
      }
    });

    // === Setup page1 (uploader) ===
    await page1.goto('/');
    await disableOthersPool(page1);
    await configureBlossomServers(page1);

    // Clear storage for fresh state
    await page1.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch {}
    });

    await page1.reload();
    await disableOthersPool(page1);
    await configureBlossomServers(page1);
    await page1.waitForSelector('header:has-text("Iris")', { timeout: 30000 });
    await navigateToPublicFolder(page1);

    // Get page1's npub from URL
    const page1Url = page1.url();
    const page1NpubMatch = page1Url.match(/npub1[a-z0-9]+/);
    expect(page1NpubMatch).toBeTruthy();
    const page1Npub = page1NpubMatch![0];
    console.log(`Page1 npub: ${page1Npub.slice(0, 20)}...`);

    // Upload video
    console.log('Uploading video...');
    const fileInput = page1.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);

    // Wait for file to appear in list
    const videoFileName = 'Big_Buck_Bunny_360_10s_1MB.mp4';
    const videoLink = page1.locator('[data-testid="file-list"] a').filter({ hasText: videoFileName }).first();
    await expect(videoLink).toBeVisible({ timeout: 60000 });
    console.log('Video uploaded and visible in list');

    // Wait for upload to complete and sync
    await page1.waitForTimeout(3000);

    // === Setup page2 (viewer) ===
    await page2.goto('/');
    await disableOthersPool(page2);
    await configureBlossomServers(page2);

    // Clear storage for fresh state
    await page2.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch {}
    });

    await page2.reload();
    await disableOthersPool(page2);
    await configureBlossomServers(page2);
    await page2.waitForSelector('header:has-text("Iris")', { timeout: 30000 });

    // Get page2's npub
    await navigateToPublicFolder(page2);
    const page2Url = page2.url();
    const page2NpubMatch = page2Url.match(/npub1[a-z0-9]+/);
    expect(page2NpubMatch).toBeTruthy();
    const page2Npub = page2NpubMatch![0];
    console.log(`Page2 npub: ${page2Npub.slice(0, 20)}...`);

    // === Have users follow each other for WebRTC connection ===
    // Page1 follows page2
    await page1.goto(`http://localhost:5173/#/${page2Npub}`);
    const followBtn1 = page1.getByRole('button', { name: 'Follow', exact: true });
    await expect(followBtn1).toBeVisible({ timeout: 30000 });
    await followBtn1.click();
    await page1.waitForTimeout(500);

    // Page2 follows page1
    await page2.goto(`http://localhost:5173/#/${page1Npub}`);
    const followBtn2 = page2.getByRole('button', { name: 'Follow', exact: true });
    await expect(followBtn2).toBeVisible({ timeout: 30000 });
    await followBtn2.click();

    // Wait for follows to sync and WebRTC connections
    await page2.waitForTimeout(5000);

    // Verify page2 can see page1's public tree in the list
    const treeLink = page2.getByRole('link', { name: 'public' });
    await expect(treeLink).toBeVisible({ timeout: 30000 });

    // === Direct navigate to the video file ===
    const videoUrl = `http://localhost:5173/#/${page1Npub}/public/${videoFileName}`;
    console.log(`Direct navigating to: ${videoUrl}`);
    await page2.goto(videoUrl);

    // Wait for the page to load
    await page2.waitForTimeout(2000);

    // Check that video element exists
    const videoElement = page2.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 30000 });
    console.log('Video element is visible');

    // Wait for video to have a source (SW URL for hashtree files)
    await page2.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video) return false;
      // Video should have a source URL
      return video.src !== '' && video.src.length > 0;
    }, { timeout: 30000 });

    // Get video state
    const videoState = await page2.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        src: video.src,
        readyState: video.readyState,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        error: video.error ? { code: video.error.code, message: video.error.message } : null,
        networkState: video.networkState,
      };
    });

    console.log('Video state:', JSON.stringify(videoState, null, 2));

    // Video should not have an error
    expect(videoState).not.toBeNull();
    expect(videoState!.error).toBeNull();
    expect(videoState!.src).toBeTruthy();

    // Wait for video metadata to load
    await page2.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1 && video.duration > 0;
    }, { timeout: 30000 });

    // Verify video properties
    const finalVideoState = await page2.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      };
    });

    console.log('Final video state:', JSON.stringify(finalVideoState, null, 2));

    // Video should have correct duration (~10 seconds) and dimensions
    expect(finalVideoState).not.toBeNull();
    expect(finalVideoState!.duration).toBeGreaterThan(9);
    expect(finalVideoState!.duration).toBeLessThan(11);
    expect(finalVideoState!.videoWidth).toBe(640);
    expect(finalVideoState!.videoHeight).toBe(360);

    console.log('=== Video Direct Navigation Test Passed ===');

    // Cleanup
    await context1.close();
    await context2.close();
  });

  test('browser B loads video via Blossom after browser A uploads and closes', async ({ browser }) => {
    test.slow(); // Multi-browser test with Blossom sync

    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);

    // Create first browser context (uploader)
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    setupPageErrorHandler(page1);

    // Console logging for debugging
    page1.on('console', msg => {
      const text = msg.text();
      if (text.includes('Blossom') || text.includes('blossom') || text.includes('upload') || text.includes('error')) {
        console.log(`[page1] ${text}`);
      }
    });

    // === Setup page1 (uploader) ===
    await page1.goto('/');
    await disableOthersPool(page1);
    await configureBlossomServers(page1);

    // Clear storage for fresh state
    await page1.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch {}
    });

    await page1.reload();
    await disableOthersPool(page1);
    await configureBlossomServers(page1);
    await page1.waitForSelector('header:has-text("Iris")', { timeout: 30000 });
    await navigateToPublicFolder(page1);

    // Get page1's npub from URL
    const page1Url = page1.url();
    const page1NpubMatch = page1Url.match(/npub1[a-z0-9]+/);
    expect(page1NpubMatch).toBeTruthy();
    const page1Npub = page1NpubMatch![0];
    console.log(`Page1 npub: ${page1Npub.slice(0, 20)}...`);

    // Upload video
    console.log('Uploading video...');
    const fileInput = page1.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_VIDEO);

    // Wait for file to appear in list
    const videoFileName = 'Big_Buck_Bunny_360_10s_1MB.mp4';
    const videoLink = page1.locator('[data-testid="file-list"] a').filter({ hasText: videoFileName }).first();
    await expect(videoLink).toBeVisible({ timeout: 60000 });
    console.log('Video uploaded and visible in list');

    // Wait for Blossom upload to complete (background sync)
    // The app uploads to Blossom in the background after local save
    console.log('Waiting for Blossom upload to complete...');
    await page1.waitForTimeout(10000);

    // Close page1 - browser A is now gone
    console.log('Closing browser A...');
    await context1.close();

    // Wait a moment before opening browser B
    await new Promise(resolve => setTimeout(resolve, 2000));

    // === Setup page2 (viewer) - fresh browser after A closed ===
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    setupPageErrorHandler(page2);

    // Console logging for debugging
    page2.on('console', msg => {
      const text = msg.text();
      if (text.includes('Blossom') || text.includes('blossom') || text.includes('fetch') ||
          text.includes('video') || text.includes('error') || text.includes('Error')) {
        console.log(`[page2] ${text}`);
      }
    });

    await page2.goto('/');
    await disableOthersPool(page2);
    await configureBlossomServers(page2);

    // Clear storage for truly fresh state
    await page2.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
      try {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      } catch {}
    });

    await page2.reload();
    await disableOthersPool(page2);
    await configureBlossomServers(page2);
    await page2.waitForSelector('header:has-text("Iris")', { timeout: 30000 });

    // === Direct navigate to the video file ===
    // Page2 does NOT follow page1 - the only way to get the video is via Blossom
    const videoUrl = `http://localhost:5173/#/${page1Npub}/public/${videoFileName}`;
    console.log(`Direct navigating to: ${videoUrl}`);
    await page2.goto(videoUrl);

    // Wait for the page to load
    await page2.waitForTimeout(3000);

    // Check that video element exists
    const videoElement = page2.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 30000 });
    console.log('Video element is visible');

    // Wait for video to have a source
    await page2.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video) return false;
      return video.src !== '' && video.src.length > 0;
    }, { timeout: 30000 });

    // Get video state
    const videoState = await page2.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        src: video.src,
        readyState: video.readyState,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        error: video.error ? { code: video.error.code, message: video.error.message } : null,
        networkState: video.networkState,
      };
    });

    console.log('Video state:', JSON.stringify(videoState, null, 2));

    // Video should not have an error
    expect(videoState).not.toBeNull();
    expect(videoState!.error).toBeNull();
    expect(videoState!.src).toBeTruthy();

    // Wait for video metadata to load (may take time to fetch from Blossom)
    await page2.waitForFunction(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      return video && video.readyState >= 1 && video.duration > 0;
    }, { timeout: 45000 });

    // Verify video properties
    const finalVideoState = await page2.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      return {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      };
    });

    console.log('Final video state:', JSON.stringify(finalVideoState, null, 2));

    // Video should have correct duration (~10 seconds) and dimensions
    expect(finalVideoState).not.toBeNull();
    expect(finalVideoState!.duration).toBeGreaterThan(9);
    expect(finalVideoState!.duration).toBeLessThan(11);
    expect(finalVideoState!.videoWidth).toBe(640);
    expect(finalVideoState!.videoHeight).toBe(360);

    console.log('=== Video Blossom Fallback Test Passed ===');

    // Cleanup
    await context2.close();
  });
});
