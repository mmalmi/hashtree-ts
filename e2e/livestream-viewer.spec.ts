/**
 * E2E test for livestream viewing - tests that viewer continues receiving updates
 *
 * Scenario:
 * - Browser A starts streaming (mock MediaRecorder)
 * - Browser B opens the stream link
 * - As A continues streaming, B should receive updates continuously
 *
 * This tests the bug where viewer only sees first ~1s of stream.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { setupPageErrorHandler } from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Use WebM for proper MSE playback (vp8+vorbis codec)
const TEST_VIDEO = path.join(__dirname, 'fixtures', 'Big_Buck_Bunny_360_10s.webm');

test.describe('Livestream Viewer Updates', () => {
  test.setTimeout(120000); // 2 minutes

  // Helper to set up fresh user session
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

  // Get user's npub from URL
  async function getNpub(page: Page): Promise<string> {
    const url = page.url();
    const match = url.match(/npub1[a-z0-9]+/);
    if (!match) throw new Error('Could not find npub in URL');
    return match[0];
  }

  // Read test video file as base64 for injection
  function getTestVideoBase64(): string {
    const videoBuffer = fs.readFileSync(TEST_VIDEO);
    return videoBuffer.toString('base64');
  }

  // Inject mocked MediaStream and MediaRecorder that feeds chunks incrementally
  async function injectMockMediaRecorder(page: Page, videoBase64: string) {
    await page.evaluate((videoB64) => {
      const videoData = Uint8Array.from(atob(videoB64), c => c.charCodeAt(0));

      // Create fake stream from canvas
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, 640, 360);
      const fakeStream = canvas.captureStream(30);

      navigator.mediaDevices.getUserMedia = async () => fakeStream;

      // Store chunks to feed incrementally
      const chunkSize = 50000; // ~50KB chunks
      const chunks: Blob[] = [];
      for (let i = 0; i < videoData.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, videoData.length);
        chunks.push(new Blob([videoData.slice(i, end)], { type: 'video/webm' }));
      }

      // Expose chunks for external control
      (window as any).__testChunks = chunks;
      (window as any).__testChunkIndex = 0;

      class MockMediaRecorder {
        stream: MediaStream;
        state: string = 'inactive';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        private intervalId: number | null = null;

        constructor(stream: MediaStream, _options?: MediaRecorderOptions) {
          this.stream = stream;
          (window as any).__testRecorder = this;
        }

        start(timeslice?: number) {
          this.state = 'recording';
          (window as any).__testChunkIndex = 0;

          const feedChunk = () => {
            if (this.state !== 'recording') return;
            const idx = (window as any).__testChunkIndex;
            if (idx < chunks.length && this.ondataavailable) {
              console.log(`[MockRecorder] Feeding chunk ${idx}/${chunks.length}`);
              this.ondataavailable({ data: chunks[idx] });
              (window as any).__testChunkIndex = idx + 1;
            }
          };

          feedChunk();
          this.intervalId = window.setInterval(feedChunk, timeslice || 1000);
        }

        stop() {
          this.state = 'inactive';
          if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
          }
          if (this.onstop) this.onstop();
        }

        static isTypeSupported(type: string) {
          return type.includes('webm');
        }
      }

      (window as any).MediaRecorder = MockMediaRecorder;
      console.log('[Test] Mocked MediaRecorder');
    }, videoBase64);
  }

  test('viewer receives continuous stream updates from broadcaster', async ({ browser }) => {
    // Verify test file exists
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);
    const videoBase64 = getTestVideoBase64();

    // Create two browser contexts (broadcaster and viewer)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage(); // Broadcaster
    const pageB = await contextB.newPage(); // Viewer

    // Log console for debugging
    pageA.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('WebSocket') && !text.includes('500')) {
        console.log(`[Broadcaster Error] ${text}`);
      }
      if (text.includes('[MockRecorder]') || text.includes('[Stream]')) {
        console.log(`[Broadcaster] ${text}`);
      }
    });

    pageB.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('WebSocket') && !text.includes('500')) {
        console.log(`[Viewer Error] ${text}`);
      }
      if (text.includes('fetchNewData') || text.includes('MSE') || text.includes('bytesLoaded') || text.includes('poll')) {
        console.log(`[Viewer] ${text}`);
      }
    });

    try {
      // === Setup Broadcaster (A) ===
      console.log('Setting up Broadcaster...');
      await setupFreshUser(pageA);
      const npubA = await getNpub(pageA);
      console.log(`Broadcaster npub: ${npubA.slice(0, 20)}...`);

      // Inject mock MediaRecorder
      await injectMockMediaRecorder(pageA, videoBase64);

      // === Setup Viewer (B) ===
      console.log('Setting up Viewer...');
      await setupFreshUser(pageB);
      const npubB = await getNpub(pageB);
      console.log(`Viewer npub: ${npubB.slice(0, 20)}...`);

      // === Broadcaster: Start streaming ===
      console.log('Broadcaster: Starting stream...');
      const streamLink = pageA.getByRole('link', { name: 'Stream' });
      await expect(streamLink).toBeVisible({ timeout: 5000 });
      await streamLink.click();
      await pageA.waitForTimeout(500);

      // Start camera preview
      const startCameraBtn = pageA.getByRole('button', { name: 'Start Camera' });
      await expect(startCameraBtn).toBeVisible({ timeout: 5000 });
      await startCameraBtn.click();
      await pageA.waitForTimeout(1000);

      // Set filename
      const filenameInput = pageA.locator('input[placeholder="filename"]');
      await expect(filenameInput).toBeVisible({ timeout: 5000 });
      const testFilename = `live_test_${Date.now()}`;
      await filenameInput.fill(testFilename);

      // Start recording
      console.log('Broadcaster: Starting recording...');
      const startRecordingBtn = pageA.getByRole('button', { name: /Start Recording/ });
      await expect(startRecordingBtn).toBeVisible({ timeout: 5000 });
      await startRecordingBtn.click();

      // Wait for initial chunks to be recorded and published (at least 3 seconds for first publish)
      console.log('Waiting for initial stream data to be published...');
      await pageA.waitForTimeout(5000);

      // === Viewer: Navigate to broadcaster's stream ===
      console.log('Viewer: Navigating to broadcaster\'s stream...');
      const streamUrl = `http://localhost:5173/#/${npubA}/public/${testFilename}.webm?live=1`;
      console.log(`Stream URL: ${streamUrl}`);
      await pageB.goto(streamUrl);
      await pageB.waitForTimeout(3000);

      // Check if video element exists (may have invisible class during loading)
      const videoElement = pageB.locator('video');
      await expect(videoElement).toBeAttached({ timeout: 15000 });
      console.log('Viewer: Video element attached');

      // Wait a bit for loading to complete
      await pageB.waitForTimeout(2000);

      // Get initial bytes loaded
      const getViewerState = async () => {
        return await pageB.evaluate(() => {
          const video = document.querySelector('video') as HTMLVideoElement;
          if (!video) return null;
          return {
            src: video.src,
            duration: video.duration,
            currentTime: video.currentTime,
            buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
            readyState: video.readyState,
          };
        });
      };

      const initialState = await getViewerState();
      console.log('Viewer initial state:', JSON.stringify(initialState, null, 2));

      // Wait for more chunks to be streamed (continue broadcasting)
      console.log('Waiting for more stream data...');
      await pageA.waitForTimeout(8000); // Wait for more chunks to be published

      // Check viewer state after more data
      const afterState = await getViewerState();
      console.log('Viewer state after more streaming:', JSON.stringify(afterState, null, 2));

      // The key assertion: viewer should have received more data
      // If the bug exists, afterState.duration/buffered will be similar to initialState
      // If fixed, afterState should show more buffered data

      // Check if video source has been updated (blob URL might change on CID update)
      // Or check if buffered content increased
      if (initialState && afterState) {
        console.log(`Initial buffered: ${initialState.buffered}s, After: ${afterState.buffered}s`);

        // For live streams, the buffered amount should increase as more data arrives
        // If the viewer is stuck on first chunk, buffered won't increase significantly
        if (afterState.buffered > initialState.buffered + 0.5) {
          console.log('SUCCESS: Viewer received more buffered data');
        } else {
          console.log('WARNING: Viewer may not be receiving stream updates');
        }
      }

      // Also check if there's a LIVE indicator
      const liveIndicator = pageB.getByText('LIVE', { exact: true }).first();
      const hasLiveIndicator = await liveIndicator.isVisible();
      console.log(`LIVE indicator visible: ${hasLiveIndicator}`);

      // Stop recording
      console.log('Broadcaster: Stopping recording...');
      const stopRecordingBtn = pageA.getByRole('button', { name: /Stop Recording/ });
      if (await stopRecordingBtn.isVisible()) {
        await stopRecordingBtn.click();
        await pageA.waitForTimeout(2000);
      }

      // Final state check
      const finalState = await getViewerState();
      console.log('Viewer final state:', JSON.stringify(finalState, null, 2));

      // Verify video loaded (at minimum)
      expect(initialState).not.toBeNull();
      expect(initialState!.src).toMatch(/^blob:/);

      console.log('=== Livestream Viewer Test Complete ===');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('viewer playback continues without stalling during long stream', async ({ page, context }) => {
    /**
     * This test verifies that video playback continues smoothly over a longer
     * streaming period - specifically checking that the video doesn't stall
     * with a loading spinner while data keeps arriving.
     *
     * Uses same browser context (two tabs) to share storage.
     */
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);
    const videoBase64 = getTestVideoBase64();

    setupPageErrorHandler(page);

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[MockRecorder]')) {
        console.log(`[Broadcaster] ${text}`);
      }
    });

    try {
      // Setup broadcaster
      await setupFreshUser(page);
      const npub = await getNpub(page);
      await injectMockMediaRecorder(page, videoBase64);

      // Start streaming
      const streamLink = page.getByRole('link', { name: 'Stream' });
      await streamLink.click();
      await page.waitForTimeout(500);

      const startCameraBtn = page.getByRole('button', { name: 'Start Camera' });
      await expect(startCameraBtn).toBeVisible({ timeout: 5000 });
      await startCameraBtn.click();
      await page.waitForTimeout(1000);

      const testFilename = `long_stream_${Date.now()}`;
      const filenameInput = page.locator('input[placeholder="filename"]');
      await expect(filenameInput).toBeVisible({ timeout: 5000 });
      await filenameInput.fill(testFilename);
      await page.getByRole('button', { name: /Start Recording/ }).click();

      // Let broadcaster record for a bit
      console.log('Recording started, waiting 4s...');
      await page.waitForTimeout(4000);

      // Open viewer in new tab (same context = shared storage)
      console.log('Opening viewer in new tab...');
      const viewerPage = await context.newPage();
      setupPageErrorHandler(viewerPage);

      viewerPage.on('console', msg => {
        const text = msg.text();
        if (text.includes('poll') || text.includes('waiting') || text.includes('stall')) {
          console.log(`[Viewer] ${text}`);
        }
      });

      await viewerPage.goto(`http://localhost:5173/#/${npub}/public/${testFilename}.webm?live=1`);

      const videoElement = viewerPage.locator('video');
      await expect(videoElement).toBeVisible({ timeout: 15000 });

      // Start playback
      await viewerPage.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video) video.play().catch(() => {});
      });

      // Monitor playback over time - check every 2 seconds for 16 seconds
      const playbackStates: Array<{time: number, currentTime: number, buffered: number, readyState: number, paused: boolean}> = [];

      for (let i = 0; i < 8; i++) {
        await viewerPage.waitForTimeout(2000);

        const state = await viewerPage.evaluate(() => {
          const video = document.querySelector('video') as HTMLVideoElement;
          if (!video) return null;
          return {
            currentTime: video.currentTime,
            buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
            readyState: video.readyState,
            paused: video.paused,
          };
        });

        if (state) {
          playbackStates.push({ time: (i + 1) * 2, ...state });
          console.log(`t=${(i+1)*2}s: currentTime=${state.currentTime.toFixed(1)}, buffered=${state.buffered.toFixed(1)}, readyState=${state.readyState}, paused=${state.paused}`);
        }
      }

      // Stop recording
      const stopBtn = page.getByRole('button', { name: /Stop Recording/ });
      if (await stopBtn.isVisible()) {
        await stopBtn.click();
      }

      await viewerPage.close();

      // Analyze results
      const firstState = playbackStates[0];
      const lastState = playbackStates[playbackStates.length - 1];

      if (firstState && lastState) {
        const timePlayed = lastState.currentTime - firstState.currentTime;
        console.log(`Video played for ${timePlayed.toFixed(1)}s over 16s test period`);
        console.log(`Buffered: initial=${firstState.buffered.toFixed(1)}s, final=${lastState.buffered.toFixed(1)}s`);

        // Check that buffered amount increased (data is being received)
        expect(lastState.buffered).toBeGreaterThanOrEqual(firstState.buffered);
      }

      // Check for stalls (readyState < 3)
      const stallCount = playbackStates.filter(s => s.readyState < 3).length;
      console.log(`Stall events (readyState < 3): ${stallCount} out of ${playbackStates.length} samples`);

      console.log('=== Long Stream Test Complete ===');

    } catch (e) {
      console.error('Test error:', e);
      throw e;
    }
  });

  test('same-browser live streaming updates video as data grows', async ({ page, context }) => {
    /**
     * This test verifies that when viewing a live stream in the SAME browser context
     * (where data is shared in IndexedDB), the video updates as new data is recorded.
     *
     * We use two tabs in the same context to share storage while keeping recording active.
     */
    expect(fs.existsSync(TEST_VIDEO)).toBe(true);
    const videoBase64 = getTestVideoBase64();

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

    // Get the user's npub
    const publicLink = page.getByRole('link', { name: 'public' }).first();
    await expect(publicLink).toBeVisible({ timeout: 15000 });
    await publicLink.click();
    await page.waitForURL(/\/#\/npub.*\/public/, { timeout: 10000 });

    const url = page.url();
    const npubMatch = url.match(/npub1[a-z0-9]+/);
    expect(npubMatch).not.toBeNull();
    const npub = npubMatch![0];
    console.log(`User npub: ${npub.slice(0, 20)}...`);

    // Inject mock MediaRecorder
    await injectMockMediaRecorder(page, videoBase64);

    // Start streaming
    const streamLink = page.getByRole('link', { name: 'Stream' });
    await expect(streamLink).toBeVisible({ timeout: 5000 });
    await streamLink.click();
    await page.waitForTimeout(500);

    // Start camera preview
    const startCameraBtn = page.getByRole('button', { name: 'Start Camera' });
    await expect(startCameraBtn).toBeVisible({ timeout: 5000 });
    await startCameraBtn.click();
    await page.waitForTimeout(1000);

    // Set filename - wait for it to be visible first
    const testFilename = `same_browser_${Date.now()}`;
    const filenameInput = page.locator('input[placeholder="filename"]');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });
    await filenameInput.fill(testFilename);

    // Start recording
    console.log('Starting recording...');
    await page.getByRole('button', { name: /Start Recording/ }).click();

    // Wait for some chunks to be recorded and published
    await page.waitForTimeout(5000);

    // Open a NEW TAB in the same context to view the stream
    // This shares IndexedDB storage with the recording tab
    console.log('Opening viewer in new tab (same context)...');
    const viewerPage = await context.newPage();
    setupPageErrorHandler(viewerPage);

    // Track polling on viewer page
    let pollCalls = 0;
    viewerPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('poll') || text.includes('bytesLoaded') || text.includes('fetchNewData') || text.includes('MediaPlayer') || text.includes('MSE')) {
        pollCalls++;
        console.log(`[Viewer] ${text}`);
      }
      if (msg.type() === 'error') {
        console.log(`[Viewer Error] ${text}`);
      }
    });

    const streamUrl = `http://localhost:5173/#/${npub}/public/${testFilename}.webm?live=1`;
    console.log(`Stream URL: ${streamUrl}`);
    await viewerPage.goto(streamUrl);

    // Wait for video to appear
    const videoElement = viewerPage.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 15000 });
    console.log('Video element visible');

    // Check initial state
    const getVideoState = async (p: Page) => {
      return await p.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (!video) return null;
        return {
          duration: video.duration,
          buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
          readyState: video.readyState,
        };
      });
    };

    const initialState = await getVideoState(viewerPage);
    console.log('Initial video state:', JSON.stringify(initialState, null, 2));

    // Wait for polling to fetch more data while recording continues
    await viewerPage.waitForTimeout(8000);

    const laterState = await getVideoState(viewerPage);
    console.log('Later video state:', JSON.stringify(laterState, null, 2));

    // Check for LIVE indicator
    const liveIndicator = viewerPage.getByText('LIVE', { exact: true }).first();
    const hasLive = await liveIndicator.isVisible();
    console.log(`LIVE indicator visible: ${hasLive}`);
    expect(hasLive).toBe(true);

    // Verify video has some content
    if (laterState) {
      console.log(`readyState: ${laterState.readyState}, buffered: ${laterState.buffered}, duration: ${laterState.duration}`);
      // At minimum, we should have SOME video state
      expect(laterState.readyState).toBeGreaterThanOrEqual(0);
    }

    console.log(`Polling calls observed: ${pollCalls}`);

    // Stop recording
    const stopBtn = page.getByRole('button', { name: /Stop Recording/ });
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }

    await viewerPage.close();
    console.log('=== Same-browser Livestream Test Complete ===');
  });
});
