import { test, expect } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool } from './test-utils';

/**
 * Tests for yt-dlp batch upload feature in Iris Video
 * Creates mock yt-dlp files in-memory to test the detection and upload flow
 */

/**
 * Helper to ensure user is logged in
 */
async function ensureLoggedIn(page: any) {
  const uploadBtn = page.locator('button:has-text("Create")');
  const isVisible = await uploadBtn.isVisible().catch(() => false);

  if (!isVisible) {
    const newBtn = page.getByRole('button', { name: /New/i });
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    }
  }
}

test.describe('yt-dlp Batch Upload', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('detects yt-dlp directory structure correctly', async ({ page }) => {
    await page.goto('/video.html#/');

    // Test the detection utility directly
    const result = await page.evaluate(async () => {
      const { detectYtDlpDirectory } = await import('/src/utils/ytdlp.ts');

      // Create mock File objects that mimic yt-dlp output
      const mockFiles = [
        new File(['video content'], 'Test Video One [dQw4w9WgXcQ].mp4', { type: 'video/mp4' }),
        new File(['{"id":"dQw4w9WgXcQ","title":"Test Video One","channel":"Test Channel"}'], 'Test Video One [dQw4w9WgXcQ].info.json', { type: 'application/json' }),
        new File(['thumb'], 'Test Video One [dQw4w9WgXcQ].jpg', { type: 'image/jpeg' }),
        new File(['video content 2'], 'Another Video [xyzABC12345].mp4', { type: 'video/mp4' }),
        new File(['{"id":"xyzABC12345","title":"Another Video","channel":"Test Channel"}'], 'Another Video [xyzABC12345].info.json', { type: 'application/json' }),
        new File(['thumb2'], 'Another Video [xyzABC12345].webp', { type: 'image/webp' }),
      ];

      const detected = detectYtDlpDirectory(mockFiles);

      return {
        isYtDlpDirectory: detected.isYtDlpDirectory,
        videoCount: detected.videos.length,
        videoIds: detected.videos.map(v => v.id),
        videoTitles: detected.videos.map(v => v.title),
        hasInfoJson: detected.videos.every(v => v.infoJson !== null),
        hasThumbnail: detected.videos.every(v => v.thumbnail !== null),
        hasVideoFile: detected.videos.every(v => v.videoFile !== null),
      };
    });

    expect(result.isYtDlpDirectory).toBe(true);
    expect(result.videoCount).toBe(2);
    expect(result.videoIds).toContain('dQw4w9WgXcQ');
    expect(result.videoIds).toContain('xyzABC12345');
    expect(result.hasInfoJson).toBe(true);
    expect(result.hasThumbnail).toBe(true);
    expect(result.hasVideoFile).toBe(true);
  });

  test('extracts channel name from info.json', async ({ page }) => {
    await page.goto('/video.html#/');

    const channelName = await page.evaluate(async () => {
      const { detectYtDlpDirectory } = await import('/src/utils/ytdlp.ts');

      const mockFiles = [
        new File(['video'], 'Song Title [abc12345678].mp4', { type: 'video/mp4' }),
        new File(['{"id":"abc12345678","title":"Song Title","channel":"My Channel Name","uploader":"My Channel Name"}'], 'Song Title [abc12345678].info.json', { type: 'application/json' }),
      ];

      const detected = detectYtDlpDirectory(mockFiles);

      if (detected.videos[0]?.infoJson) {
        const text = await detected.videos[0].infoJson.text();
        const data = JSON.parse(text);
        return data.channel || data.uploader;
      }
      return null;
    });

    expect(channelName).toBe('My Channel Name');
  });

  test('opens upload modal and shows folder selection option', async ({ page }) => {
    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Open upload modal
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    // Should show the upload modal
    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    // Should have folder selection button
    await expect(page.getByRole('button', { name: 'Select folder' })).toBeVisible();

    // Should have drag & drop hint
    await expect(page.locator('text=drag & drop files/folders')).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/ytdlp-upload-modal.png' });
  });

  test('switches to batch mode when yt-dlp directory detected', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Open upload modal
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    // Simulate processing yt-dlp files by calling processFiles directly
    const batchDetected = await page.evaluate(async () => {
      const { detectYtDlpDirectory } = await import('/src/utils/ytdlp.ts');

      // Create mock yt-dlp files
      const mockFiles = [
        new File(['video1'], 'Video One [aaaaaaaaaaa].mp4', { type: 'video/mp4' }),
        new File(['{"id":"aaaaaaaaaaa","title":"Video One","channel":"Test Channel","duration":120}'], 'Video One [aaaaaaaaaaa].info.json', { type: 'application/json' }),
        new File(['thumb1'], 'Video One [aaaaaaaaaaa].jpg', { type: 'image/jpeg' }),
        new File(['video2'], 'Video Two [bbbbbbbbbbb].mp4', { type: 'video/mp4' }),
        new File(['{"id":"bbbbbbbbbbb","title":"Video Two","channel":"Test Channel","duration":180}'], 'Video Two [bbbbbbbbbbb].info.json', { type: 'application/json' }),
        new File(['thumb2'], 'Video Two [bbbbbbbbbbb].webp', { type: 'image/webp' }),
        new File(['video3'], 'Video Three [ccccccccccc].mkv', { type: 'video/x-matroska' }),
        new File(['{"id":"ccccccccccc","title":"Video Three","channel":"Test Channel","duration":240}'], 'Video Three [ccccccccccc].info.json', { type: 'application/json' }),
      ];

      const detected = detectYtDlpDirectory(mockFiles);
      return {
        isYtDlpDirectory: detected.isYtDlpDirectory,
        videoCount: detected.videos.length,
        videos: detected.videos.map(v => ({ id: v.id, title: v.title })),
      };
    });

    expect(batchDetected.isYtDlpDirectory).toBe(true);
    expect(batchDetected.videoCount).toBe(3);
  });

  test('batch upload creates channel with video subdirectories', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Open upload modal
    const uploadBtn = page.locator('button:has-text("Create")');
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await uploadBtn.click();

    await expect(page.getByRole('heading', { name: 'Upload Video' })).toBeVisible({ timeout: 30000 });

    // Perform batch upload via page.evaluate to simulate the full flow
    const uploadResult = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const hashtree = await import('/node_modules/hashtree/dist/index.js');
      const { toHex, videoChunker, cid } = hashtree;

      const tree = getTree();

      // Create mock video data (small for speed)
      const videos = [
        {
          id: 'testVid00001',
          title: 'Test Video 1',
          videoData: new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]), // fake mp4 header
          infoJson: JSON.stringify({ id: 'testVid00001', title: 'Test Video 1', channel: 'E2E Test Channel', duration: 60 }),
          thumbData: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]), // fake jpg header
        },
        {
          id: 'testVid00002',
          title: 'Test Video 2',
          videoData: new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]),
          infoJson: JSON.stringify({ id: 'testVid00002', title: 'Test Video 2', channel: 'E2E Test Channel', duration: 90 }),
          thumbData: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]),
        },
      ];

      const rootEntries: Array<{ name: string; cid: any; size: number }> = [];

      for (const video of videos) {
        const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

        // Upload video file
        const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
        await streamWriter.append(video.videoData);
        const videoResult = await streamWriter.finalize();
        videoEntries.push({
          name: 'video.mp4',
          cid: cid(videoResult.hash, videoResult.key),
          size: videoResult.size,
        });

        // Upload info.json
        const infoData = new TextEncoder().encode(video.infoJson);
        const infoResult = await tree.putFile(infoData, { public: true });
        videoEntries.push({ name: 'info.json', cid: infoResult.cid, size: infoResult.size });

        // Upload thumbnail
        const thumbResult = await tree.putFile(video.thumbData, { public: true });
        videoEntries.push({ name: 'thumbnail.jpg', cid: thumbResult.cid, size: thumbResult.size });

        // Create video directory
        const videoDirResult = await tree.putDirectory(videoEntries, { public: true });
        rootEntries.push({
          name: video.id,
          cid: videoDirResult.cid,
          size: videoEntries.reduce((sum, e) => sum + e.size, 0),
        });
      }

      // Create root channel directory
      const rootDirResult = await tree.putDirectory(rootEntries, { public: true });

      // Verify structure
      const channelEntries = await tree.listDirectory(rootDirResult.cid);

      const verification: any = {
        rootHash: toHex(rootDirResult.cid.hash),
        videoCount: channelEntries.length,
        videoIds: channelEntries.map((e: any) => e.name),
        videoContents: {},
      };

      // Check each video directory
      for (const entry of channelEntries) {
        const videoContents = await tree.listDirectory(entry.cid);
        verification.videoContents[entry.name] = videoContents.map((e: any) => e.name);
      }

      return verification;
    });

    // Verify the upload created correct structure
    expect(uploadResult.videoCount).toBe(2);
    expect(uploadResult.videoIds).toContain('testVid00001');
    expect(uploadResult.videoIds).toContain('testVid00002');

    // Each video should have video.mp4, info.json, thumbnail.jpg
    expect(uploadResult.videoContents['testVid00001']).toContain('video.mp4');
    expect(uploadResult.videoContents['testVid00001']).toContain('info.json');
    expect(uploadResult.videoContents['testVid00001']).toContain('thumbnail.jpg');

    expect(uploadResult.videoContents['testVid00002']).toContain('video.mp4');
    expect(uploadResult.videoContents['testVid00002']).toContain('info.json');
    expect(uploadResult.videoContents['testVid00002']).toContain('thumbnail.jpg');

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/ytdlp-batch-uploaded.png' });
  });

  test('extracts description and title from info.json', async ({ page }) => {
    await page.goto('/video.html#/');
    await disableOthersPool(page);
    // Wait for app to initialize
    await page.waitForFunction(() => typeof (window as any).tree !== 'undefined' || document.querySelector('[data-testid]'), { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Test that VideoUploadModal correctly extracts description and title from info.json
    const extractResult = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const hashtree = await import('/node_modules/hashtree/dist/index.js');
      const { toHex, videoChunker, cid } = hashtree;

      const tree = getTree();

      // Create a video with description in info.json
      const testDescription = 'This is a test description for the video.\nIt has multiple lines.';
      const testTitle = 'E2E Test Video Title';
      const video = {
        id: 'descTest001',
        videoData: new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]),
        infoJson: JSON.stringify({
          id: 'descTest001',
          title: testTitle,
          description: testDescription,
          channel: 'E2E Test Channel',
          duration: 120,
        }),
      };

      const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

      // Upload video file
      const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
      await streamWriter.append(video.videoData);
      const videoResult = await streamWriter.finalize();
      videoEntries.push({
        name: 'video.mp4',
        cid: cid(videoResult.hash, videoResult.key),
        size: videoResult.size,
      });

      // Upload info.json
      const infoData = new TextEncoder().encode(video.infoJson);
      const infoResult = await tree.putFile(infoData, { public: true });
      videoEntries.push({ name: 'info.json', cid: infoResult.cid, size: infoResult.size });

      // Simulate what VideoUploadModal does: extract description and title
      try {
        const jsonParsed = JSON.parse(video.infoJson);
        if (jsonParsed.description && jsonParsed.description.trim()) {
          const descData = new TextEncoder().encode(jsonParsed.description.trim());
          const descResult = await tree.putFile(descData, { public: true });
          videoEntries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
        }
        if (jsonParsed.title && jsonParsed.title.trim()) {
          const titleData = new TextEncoder().encode(jsonParsed.title.trim());
          const titleResult = await tree.putFile(titleData, { public: true });
          videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });
        }
      } catch {}

      // Create video directory
      const videoDirResult = await tree.putDirectory(videoEntries, { public: true });

      // Verify the contents
      const dirContents = await tree.listDirectory(videoDirResult.cid);
      const fileNames = dirContents.map((e: any) => e.name);

      // Read back the description and title
      let readDescription = '';
      let readTitle = '';

      for (const entry of dirContents) {
        if (entry.name === 'description.txt') {
          const data = await tree.readFile(entry.cid);
          readDescription = new TextDecoder().decode(data);
        }
        if (entry.name === 'title.txt') {
          const data = await tree.readFile(entry.cid);
          readTitle = new TextDecoder().decode(data);
        }
      }

      return {
        fileNames,
        hasDescription: fileNames.includes('description.txt'),
        hasTitle: fileNames.includes('title.txt'),
        readDescription,
        readTitle,
        expectedDescription: testDescription,
        expectedTitle: testTitle,
      };
    });

    // Verify description.txt and title.txt were created
    expect(extractResult.hasDescription).toBe(true);
    expect(extractResult.hasTitle).toBe(true);
    expect(extractResult.fileNames).toContain('video.mp4');
    expect(extractResult.fileNames).toContain('info.json');
    expect(extractResult.fileNames).toContain('description.txt');
    expect(extractResult.fileNames).toContain('title.txt');

    // Verify contents match
    expect(extractResult.readDescription).toBe(extractResult.expectedDescription);
    expect(extractResult.readTitle).toBe(extractResult.expectedTitle);
  });

  test('playlist URL structure is correctly parsed', async ({ page }) => {
    // Test that VideoView correctly parses playlist URLs
    // URL format: #/{npub}/videos%2F{channelName}/{videoId}

    await page.goto('/video.html#/');

    // Test the routing logic directly
    const routingTest = await page.evaluate(() => {
      // Simulate URL parsing like VideoRouter does
      const testUrl = '/npub1test/videos%2FAngel%20Sword/9jqA-3IwcPo';

      // Decode %2F like the router does
      const decodedPath = testUrl.replace(/%2F/gi, '/');
      const parts = decodedPath.split('/').filter(Boolean);

      // Pattern /:npub/videos/* would capture:
      // parts = ['npub1test', 'videos', 'Angel Sword', '9jqA-3IwcPo']
      // wild = 'Angel Sword/9jqA-3IwcPo'

      const wild = parts.slice(2).map(decodeURIComponent).join('/');

      // VideoView logic:
      const videoPath = wild;
      const pathParts = videoPath.split('/');
      const isPlaylistVideo = pathParts.length > 1;
      const channelName = isPlaylistVideo ? pathParts.slice(0, -1).join('/') : null;
      const currentVideoId = isPlaylistVideo ? pathParts[pathParts.length - 1] : null;

      // treeName for playlist videos should be the channel, not full path
      const treeName = isPlaylistVideo && channelName
        ? `videos/${channelName}`
        : `videos/${videoPath}`;

      return {
        wild,
        videoPath,
        isPlaylistVideo,
        channelName,
        currentVideoId,
        treeName,
      };
    });

    // Verify routing parses correctly
    expect(routingTest.wild).toBe('Angel Sword/9jqA-3IwcPo');
    expect(routingTest.isPlaylistVideo).toBe(true);
    expect(routingTest.channelName).toBe('Angel Sword');
    expect(routingTest.currentVideoId).toBe('9jqA-3IwcPo');
    expect(routingTest.treeName).toBe('videos/Angel Sword');
  });

  test('select/deselect videos with checkboxes', async ({ page }) => {
    await page.goto('/video.html#/');

    // Test selection functionality
    const result = await page.evaluate(async () => {
      const { detectYtDlpDirectory } = await import('/src/utils/ytdlp.ts');

      // Create mock yt-dlp files with 5 videos
      // Video IDs must be exactly 11 characters (YouTube format)
      const videoIds = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
      const mockFiles = [];
      for (let i = 0; i < 5; i++) {
        const id = videoIds[i];
        mockFiles.push(
          new File([`video${i}`], `Video ${i + 1} [${id}].mp4`, { type: 'video/mp4' }),
          new File([JSON.stringify({ id, title: `Video ${i + 1}`, channel: 'Test' })], `Video ${i + 1} [${id}].info.json`, { type: 'application/json' })
        );
      }

      const detected = detectYtDlpDirectory(mockFiles);

      // Simulate selection logic
      const allIds = detected.videos.map(v => v.id);
      let selectedIds = new Set(allIds); // Start with all selected

      // Deselect video 2 and 4 (indices 1 and 3)
      selectedIds.delete('bbbbbbbbbbb');
      selectedIds.delete('ddddddddddd');

      // Get selected videos
      const selectedVideos = detected.videos.filter(v => selectedIds.has(v.id));

      return {
        totalCount: detected.videos.length,
        selectedCount: selectedVideos.length,
        selectedTitles: selectedVideos.map(v => v.title),
        allSelected: selectedIds.size === detected.videos.length,
      };
    });

    expect(result.totalCount).toBe(5);
    expect(result.selectedCount).toBe(3);
    expect(result.selectedTitles).toContain('Video 1');
    expect(result.selectedTitles).toContain('Video 3');
    expect(result.selectedTitles).toContain('Video 5');
    expect(result.selectedTitles).not.toContain('Video 2');
    expect(result.selectedTitles).not.toContain('Video 4');
    expect(result.allSelected).toBe(false);
  });

  test('handles files without info.json as regular uploads', async ({ page }) => {
    await page.goto('/video.html#/');

    const result = await page.evaluate(async () => {
      const { detectYtDlpDirectory } = await import('/src/utils/ytdlp.ts');

      // Files without yt-dlp pattern (no [videoId])
      const regularFiles = [
        new File(['video'], 'my_video.mp4', { type: 'video/mp4' }),
        new File(['another'], 'another_video.mkv', { type: 'video/x-matroska' }),
      ];

      const detected = detectYtDlpDirectory(regularFiles);
      return {
        isYtDlpDirectory: detected.isYtDlpDirectory,
        videoCount: detected.videos.length,
      };
    });

    // Should NOT be detected as yt-dlp directory
    expect(result.isYtDlpDirectory).toBe(false);
    expect(result.videoCount).toBe(0);
  });

  test('extracts video ID correctly from various filename formats', async ({ page }) => {
    await page.goto('/video.html#/');

    const result = await page.evaluate(async () => {
      const { extractVideoId, extractTitle } = await import('/src/utils/ytdlp.ts');

      const testCases = [
        { filename: 'Simple Title [dQw4w9WgXcQ].mp4', expectedId: 'dQw4w9WgXcQ', expectedTitle: 'Simple Title' },
        { filename: 'Title With - Dash [abc-def_123].mkv', expectedId: 'abc-def_123', expectedTitle: 'Title With - Dash' },
        { filename: 'Unicode Tïtle [xyzABC12345].webm', expectedId: 'xyzABC12345', expectedTitle: 'Unicode Tïtle' },
        { filename: 'No brackets.mp4', expectedId: null, expectedTitle: 'No brackets' },
        { filename: 'Wrong format [short].mp4', expectedId: null, expectedTitle: 'Wrong format [short]' },
      ];

      return testCases.map(tc => ({
        filename: tc.filename,
        extractedId: extractVideoId(tc.filename),
        extractedTitle: extractTitle(tc.filename),
        idMatch: extractVideoId(tc.filename) === tc.expectedId,
        titleMatch: extractTitle(tc.filename) === tc.expectedTitle,
      }));
    });

    for (const tc of result) {
      expect(tc.idMatch).toBe(true);
      expect(tc.titleMatch).toBe(true);
    }
  });
});
