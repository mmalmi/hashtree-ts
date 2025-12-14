import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { setupPageErrorHandler, navigateToPublicFolder } from './test-utils.js';

// Increase timeout for livestream tests
test.setTimeout(60000);

test.describe('Livestream Video Stability', () => {

  async function clearStorage(page: Page) {
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });
  }

  async function waitForAutoLogin(page: Page) {
    await page.waitForSelector('header span:has-text("hashtree")', { timeout: 10000 });
  }

  // Helper to navigate to tree list and create a new tree
  async function createTree(page: Page, name: string) {
    // Navigate to tree list first
    await page.locator('header a:has-text("hashtree")').click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'New Folder' }).click();
    await page.locator('input[placeholder="Folder name..."]').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Empty directory')).toBeVisible({ timeout: 10000 });
  }

  // Helper to create a small test video file with unique name
  function createTestVideo(suffix: string = ''): string {
    const tmpDir = os.tmpdir();
    const uniqueId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const fileName = `test-stream-${uniqueId}${suffix}.webm`;
    const videoPath = path.join(tmpDir, fileName);

    // Minimal valid WebM file (just headers, enough to test player mounting)
    const webmHeader = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, // EBML header
      0x93, // Size
      0x42, 0x86, 0x81, 0x01, // EBMLVersion: 1
      0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion: 1
      0x42, 0xf2, 0x81, 0x04, // EBMLMaxIDLength: 4
      0x42, 0xf3, 0x81, 0x08, // EBMLMaxSizeLength: 8
      0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, // DocType: webm
      0x42, 0x87, 0x81, 0x04, // DocTypeVersion: 4
      0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion: 2
    ]);

    fs.writeFileSync(videoPath, webmHeader);
    return videoPath;
  }

  test('video element should not remount when merkle root updates', async ({ page }) => {
    // Single page test: create folder, upload video, view it, add more files, verify video doesn't remount
    setupPageErrorHandler(page);
    await page.goto('http://localhost:5173/');
    await clearStorage(page);
    await page.reload();
    await waitForAutoLogin(page);
    await navigateToPublicFolder(page);

    // Create folder via tree list
    await createTree(page, 'stream-test');

    // Upload a video file
    const videoPath = createTestVideo();
    const videoFileName = path.basename(videoPath);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(videoPath);

    // Wait for video file to appear in the list
    const fileList = page.getByTestId('file-list');
    await expect(fileList.locator(`span:text-is("${videoFileName}")`)).toBeVisible({ timeout: 10000 });

    // Click on video to view it
    await fileList.locator(`span:text-is("${videoFileName}")`).click();

    // Wait for video element to appear
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 10000 });

    // Set a marker on the video element to detect remounting
    // Also track if video ever becomes null/invisible during the test
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        (video as any).__testMarker = 'original-video-element';
        (video as any).__mountCount = 1;
      }
      // Set up a MutationObserver to detect if video is removed/re-added
      (window as any).__videoRemovalDetected = false;
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.removedNodes) {
            if (node.nodeName === 'VIDEO') {
              (window as any).__videoRemovalDetected = true;
              console.log('[TEST] Video element was removed from DOM!');
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as any).__testObserver = observer;
    });

    const getVideoState = async () => {
      return await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          exists: !!video,
          marker: video ? (video as any).__testMarker || null : null,
          removalDetected: (window as any).__videoRemovalDetected,
        };
      });
    };

    const stateBefore = await getVideoState();
    console.log('Video state before update:', stateBefore);
    expect(stateBefore.exists).toBe(true);
    expect(stateBefore.marker).toBe('original-video-element');

    // Upload TWO files to trigger merkle root update without auto-navigating
    // (single file upload auto-navigates to it, but multi-file upload doesn't)
    const textPath1 = path.join(os.tmpdir(), 'update1.txt');
    const textPath2 = path.join(os.tmpdir(), 'update2.txt');
    fs.writeFileSync(textPath1, 'This triggers merkle root update 1');
    fs.writeFileSync(textPath2, 'This triggers merkle root update 2');
    await fileInput.setInputFiles([textPath1, textPath2]);

    // Check video state during the update process
    const stateDuring1 = await getVideoState();
    console.log('Video state during update (1):', stateDuring1);

    // Wait for the new files to appear (confirms merkle root updated)
    await expect(fileList.locator('span:text-is("update1.txt")')).toBeVisible({ timeout: 10000 });
    await expect(fileList.locator('span:text-is("update2.txt")')).toBeVisible({ timeout: 10000 });

    const stateDuring2 = await getVideoState();
    console.log('Video state during update (2):', stateDuring2);

    // Wait a bit more for any async updates to settle
    await page.waitForTimeout(500);

    // Check video element - should still have the marker (wasn't remounted)
    const stateAfter = await getVideoState();
    console.log('Video state after update:', stateAfter);

    // Also check what's visible on screen
    const visibleContent = await page.evaluate(() => {
      return {
        hasVideo: !!document.querySelector('video'),
        hasMediaPlayer: !!document.querySelector('[class*="MediaPlayer"]'),
        viewerContent: document.querySelector('[data-testid="viewer-header"]')?.textContent || 'no header',
      };
    });
    console.log('Visible content:', visibleContent);

    // STRICT CHECKS - video must not have been removed at any point
    expect(stateAfter.removalDetected).toBe(false);
    expect(stateAfter.exists).toBe(true);
    expect(stateAfter.marker).toBe('original-video-element');

    // Cleanup
    fs.unlinkSync(videoPath);
    fs.unlinkSync(textPath1);
    fs.unlinkSync(textPath2);
  });

  test('video should not remount during multiple file updates', async ({ page }) => {
    setupPageErrorHandler(page);

    // Create test video upfront with unique name
    const videoPath = createTestVideo();
    const videoFileName = path.basename(videoPath);

    try {
      await page.goto('http://localhost:5173/');
      await clearStorage(page);
      await page.reload();
      await waitForAutoLogin(page);
      await navigateToPublicFolder(page);

      // Create folder via tree list
      await createTree(page, 'live-test');

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(videoPath);
      await page.waitForTimeout(1000);

      const fileList = page.getByTestId('file-list');
      await expect(fileList.locator(`span:text-is("${videoFileName}")`)).toBeVisible({ timeout: 5000 });

      // Click to view video
      await fileList.locator(`span:text-is("${videoFileName}")`).click();
      await page.waitForTimeout(500);

      // Track video element creation via instrumentation
      const videoMountCounts: number[] = [];

      page.on('console', msg => {
        if (msg.text().includes('video-mount')) {
          videoMountCounts.push(videoMountCounts.length + 1);
        }
      });

      // Add instrumentation to track video mounting
      await page.evaluate(() => {
        const originalCreateElement = document.createElement.bind(document);
        let count = 0;
        document.createElement = function(tagName: string, options?: ElementCreationOptions) {
          const el = originalCreateElement(tagName, options);
          if (tagName.toLowerCase() === 'video') {
            count++;
            console.log(`video-mount: ${count}`);
          }
          return el;
        };
      });

      // Make multiple updates
      for (let i = 0; i < 3; i++) {
        const updatePath = path.join(os.tmpdir(), `update-${i}.txt`);
        fs.writeFileSync(updatePath, `Update ${i} - ${Date.now()}`);
        await fileInput.setInputFiles(updatePath);
        await page.waitForTimeout(1500);
        fs.unlinkSync(updatePath);
      }

      console.log('Video mount counts:', videoMountCounts);

      // The video should only be created once (initial render)
      // Additional merkle root updates should NOT create new video elements
      expect(videoMountCounts.length).toBeLessThanOrEqual(1);
    } finally {
      // Cleanup
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }
  });
});
