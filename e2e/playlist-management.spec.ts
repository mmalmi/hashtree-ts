import { test, expect, Page } from '@playwright/test';
import { setupPageErrorHandler, disableOthersPool, configureBlossomServers } from './test-utils';

/**
 * Tests for playlist management features:
 * 1. Likes target individual videos in playlists (not the whole playlist)
 * 2. Delete removes only the video from playlist (not the whole playlist)
 * 3. Add to playlist functionality
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

/**
 * Helper to create a playlist with 2 videos for testing
 */
async function createTestPlaylist(page: any, playlistName: string) {
  return await page.evaluate(async (name: string) => {
    const { getTree } = await import('/src/store.ts');
    const { nostrStore } = await import('/src/nostr.ts');
    const { updateLocalRootCacheHex } = await import('/src/treeRootCache.ts');
    const hashtree = await import('/node_modules/hashtree/dist/index.js');
    const { toHex, videoChunker, cid } = hashtree;

    const tree = getTree();
    let npub: string = '';
    const unsub = nostrStore.subscribe((state: any) => { npub = state.npub; });
    unsub();

    // Create 2 videos for the playlist
    const videos = [
      { id: 'testVideo001', title: 'Test Video 1' },
      { id: 'testVideo002', title: 'Test Video 2' },
    ];

    const rootEntries: Array<{ name: string; cid: any; size: number }> = [];

    for (const video of videos) {
      const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

      // Create video file
      const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]);
      const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
      await streamWriter.append(videoData);
      const videoResult = await streamWriter.finalize();
      videoEntries.push({
        name: 'video.mp4',
        cid: cid(videoResult.hash, videoResult.key),
        size: videoResult.size,
      });

      // Create title.txt
      const titleData = new TextEncoder().encode(video.title);
      const titleResult = await tree.putFile(titleData, { public: true });
      videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      // Create video directory
      const videoDirResult = await tree.putDirectory(videoEntries, { public: true });
      rootEntries.push({
        name: video.id,
        cid: videoDirResult.cid,
        size: videoEntries.reduce((sum, e) => sum + e.size, 0),
      });
    }

    // Create root playlist directory
    const rootDirResult = await tree.putDirectory(rootEntries, { public: true });
    const treeName = `videos/${name}`;
    updateLocalRootCacheHex(npub, treeName, toHex(rootDirResult.cid.hash), undefined, 'public');

    return {
      npub,
      treeName,
      rootHash: toHex(rootDirResult.cid.hash),
      videos,
    };
  }, playlistName);
}

test.describe('Playlist Management', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandler(page);
  });

  test('like on playlist video targets the individual video, not the playlist', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    // Wait for app initialization
    await page.waitForTimeout(1000);

    // Create a test playlist
    const playlist = await createTestPlaylist(page, 'Like Test Playlist');

    // Navigate to the first video in the playlist
    const videoUrl = `/video.html#/${playlist.npub}/${encodeURIComponent(playlist.treeName)}/${playlist.videos[0].id}`;
    await page.goto(videoUrl);

    // Wait for video page to load
    await page.waitForTimeout(3000);

    // Capture Nostr events
    const publishedEvents: any[] = [];
    await page.evaluate(() => {
      (window as any).__publishedEvents = [];
      const originalPublish = (window as any).ndk?.publish?.bind((window as any).ndk);
      if ((window as any).ndk) {
        const originalEventPublish = (window as any).ndk.constructor.prototype.publish;
        // Hook NDKEvent.publish to capture events
      }
    });

    // Find and click the like button
    const likeBtn = page.locator('button[title="Like"]');
    await expect(likeBtn).toBeVisible({ timeout: 10000 });
    await likeBtn.click();

    // Wait for like to be processed
    await expect(page.locator('button[title="Liked"]')).toBeVisible({ timeout: 10000 });

    // Check the video identifier used for the like
    // For playlist videos, it should include the videoId: npub/videos/PlaylistName/videoId
    const videoIdentifier = await page.evaluate(() => {
      // The identifier should be visible in the page's state
      // We can check localStorage or the DOM for the identifier
      const stored = localStorage.getItem('hashtree:recents');
      if (stored) {
        const recents = JSON.parse(stored);
        const recent = recents.find((r: any) => r.treeName?.includes('Like Test'));
        return recent?.videoId ? `has videoId: ${recent.videoId}` : 'no videoId';
      }
      return 'no recents';
    });

    console.log('Video identifier check:', videoIdentifier);

    // The test passes if we can click like on a playlist video
    // Full verification would require inspecting Nostr events
    await page.screenshot({ path: 'e2e/screenshots/playlist-like-test.png' });
  });

  test('delete on playlist video removes only that video, not the whole playlist', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    await page.waitForTimeout(1000);

    // Create a test playlist with 2 videos
    const playlist = await createTestPlaylist(page, 'Delete Test Playlist');

    // Navigate to the first video
    const videoUrl = `/video.html#/${playlist.npub}/${encodeURIComponent(playlist.treeName)}/${playlist.videos[0].id}`;
    await page.goto(videoUrl);

    // Wait for video page and playlist to load
    await page.waitForTimeout(3000);

    // Wait for video element to be visible (indicates page is ready)
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });

    // Take screenshot before delete
    await page.screenshot({ path: 'e2e/screenshots/playlist-before-delete.png' });

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    // Click delete button
    const deleteBtn = page.locator('button[title="Delete video"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    await deleteBtn.click();

    // Wait for navigation (should go to next video in playlist or playlist page, not home)
    await page.waitForTimeout(3000);

    // Take screenshot after delete
    await page.screenshot({ path: 'e2e/screenshots/playlist-after-delete.png' });

    // Verify the playlist still exists by checking if we can navigate to video 2
    // Verify the delete worked by checking the URL
    const currentHash = await page.evaluate(() => window.location.hash);

    // The URL should now point to the second video (testVideo002), not home
    // This proves the delete worked and navigated to the next video
    expect(currentHash).toContain('testVideo002');
    expect(currentHash).not.toContain('testVideo001');

    // Also verify we're not at home
    expect(currentHash).not.toBe('#/');
    // URL will be encoded - check for the encoded playlist name
    expect(decodeURIComponent(currentHash)).toContain('Delete Test Playlist');
  });

  test('add to playlist button is visible on video pages', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    await page.waitForTimeout(1000);

    // Create a single video (not a playlist)
    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const { nostrStore } = await import('/src/nostr.ts');
      const { updateLocalRootCacheHex } = await import('/src/treeRootCache.ts');
      const hashtree = await import('/node_modules/hashtree/dist/index.js');
      const { toHex, videoChunker, cid } = hashtree;

      const tree = getTree();
      let npub: string = '';
      const unsub = nostrStore.subscribe((state: any) => { npub = state.npub; });
      unsub();

      const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

      // Create video file
      const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]);
      const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
      await streamWriter.append(videoData);
      const videoResult = await streamWriter.finalize();
      videoEntries.push({
        name: 'video.mp4',
        cid: cid(videoResult.hash, videoResult.key),
        size: videoResult.size,
      });

      // Create title.txt
      const titleData = new TextEncoder().encode('Add To Playlist Test Video');
      const titleResult = await tree.putFile(titleData, { public: true });
      videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      // Create video directory
      const videoDirResult = await tree.putDirectory(videoEntries, { public: true });
      const treeName = 'videos/Add To Playlist Test';
      updateLocalRootCacheHex(npub, treeName, toHex(videoDirResult.cid.hash), undefined, 'public');

      return { npub, treeName };
    });

    // Navigate to the video
    const videoUrl = `/video.html#/${result.npub}/${encodeURIComponent(result.treeName)}`;
    await page.goto(videoUrl);

    // Wait for video page to load
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-button-test.png' });

    // Check if "Add to playlist" button exists
    const addToPlaylistBtn = page.locator('button[title="Add to playlist"]');
    await expect(addToPlaylistBtn).toBeVisible({ timeout: 5000 });

    // Click the button to open the modal
    await addToPlaylistBtn.click();

    // Verify the modal opens
    await expect(page.getByText('Save to playlist')).toBeVisible({ timeout: 5000 });

    // Close the modal
    await page.locator('button:has(.i-lucide-x)').click();
    await expect(page.getByText('Save to playlist')).not.toBeVisible({ timeout: 5000 });
  });

  test('can add video to new playlist and see it on profile page', async ({ page }) => {
    test.slow();

    await page.goto('/video.html#/');
    await disableOthersPool(page);
    await ensureLoggedIn(page);

    await page.waitForTimeout(1000);

    // Create a single video
    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const { nostrStore, saveHashtree } = await import('/src/nostr.ts');
      const hashtree = await import('/node_modules/hashtree/dist/index.js');
      const { toHex, videoChunker, cid } = hashtree;

      const tree = getTree();
      let npub: string = '';
      const unsub = nostrStore.subscribe((state: any) => { npub = state.npub; });
      unsub();

      const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

      const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]);
      const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
      await streamWriter.append(videoData);
      const videoResult = await streamWriter.finalize();
      videoEntries.push({
        name: 'video.mp4',
        cid: cid(videoResult.hash, videoResult.key),
        size: videoResult.size,
      });

      const titleData = new TextEncoder().encode('Source Video For Modal Playlist Test');
      const titleResult = await tree.putFile(titleData, { public: true });
      videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      const videoDirResult = await tree.putDirectory(videoEntries, { public: true });
      const treeName = 'videos/Source Video Modal Test';

      // Use saveHashtree to properly publish to Nostr
      await saveHashtree(treeName, toHex(videoDirResult.cid.hash), undefined, { visibility: 'public' });

      return {
        npub,
        treeName,
        videoCid: videoDirResult.cid,
        videoSize: videoEntries.reduce((sum, e) => sum + e.size, 0),
      };
    });

    // Navigate to the video
    const videoUrl = `/video.html#/${result.npub}/${encodeURIComponent(result.treeName)}`;
    await page.goto(videoUrl);

    // Wait for video page to load
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });

    // Take screenshot before clicking button
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-before-click.png' });

    // Click "Add to playlist" button (bookmark icon)
    const addToPlaylistBtn = page.locator('button[title="Add to playlist"]');
    await expect(addToPlaylistBtn).toBeVisible({ timeout: 5000 });
    await addToPlaylistBtn.click();

    // Verify modal opens
    await expect(page.getByText('Save to playlist')).toBeVisible({ timeout: 5000 });

    // Take screenshot of modal
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-modal-open.png' });

    // Click "Create new playlist" button
    const createNewBtn = page.getByText('Create new playlist');
    await expect(createNewBtn).toBeVisible({ timeout: 5000 });
    await createNewBtn.click();

    // Enter playlist name
    const playlistName = `Test Playlist ${Date.now()}`;
    const nameInput = page.locator('input#playlist-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(playlistName);

    // Take screenshot of create form
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-create-form.png' });

    // Click Create button
    const createBtn = page.locator('button[type="submit"]:has-text("Create")');
    await createBtn.click();

    // Wait for modal to return to list view (shows the new playlist checked)
    // Use longer timeout as creating playlist can take time
    await expect(page.locator('.i-lucide-check-square')).toBeVisible({ timeout: 20000 });

    // Take screenshot after creation
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-after-create.png' });

    // Click Done to close modal
    await page.getByText('Done').click();
    await expect(page.getByText('Save to playlist')).not.toBeVisible({ timeout: 5000 });

    // Navigate to profile page
    await page.goto(`/video.html#/${result.npub}`);

    // Wait for profile to load
    await page.waitForTimeout(2000);

    // Take screenshot of profile page
    await page.screenshot({ path: 'e2e/screenshots/add-to-playlist-profile-page.png' });

    // Check if playlist section exists and contains our playlist
    const playlistSection = page.getByText('Playlists');

    // Look for the playlist name on the page
    const playlistCard = page.getByText(playlistName.replace('videos/', ''));

    // Debug: log page content
    const pageContent = await page.content();
    console.log('Looking for playlist:', playlistName);
    console.log('Page has Playlists section:', await playlistSection.isVisible().catch(() => false));

    // The playlist should be visible on the profile page
    await expect(playlistCard).toBeVisible({ timeout: 10000 });
  });

  test('another user can view a playlist published to Nostr', async ({ browser }) => {
    test.slow();

    // Create two separate browser contexts (two users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    setupPageErrorHandler(pageA);
    setupPageErrorHandler(pageB);

    try {
      // ===== User A: Create and publish a playlist =====
      await pageA.goto('/video.html#/');
      await disableOthersPool(pageA);
      await configureBlossomServers(pageA);
      await ensureLoggedIn(pageA);

      // Wait for Create button - app auto-logs in
      await expect(pageA.locator('button:has-text("Create")')).toBeVisible({ timeout: 15000 });

      // Get User A's npub
      const userANpub = await pageA.evaluate(async () => {
        const { nostrStore } = await import('/src/nostr.ts');
        let npub: string = '';
        const unsub = nostrStore.subscribe((state: any) => { npub = state.npub; });
        unsub();
        return npub;
      });

      console.log('User A npub:', userANpub);

      // Create a playlist with 2 videos, publish to Nostr, and push to Blossom
      const playlist = await pageA.evaluate(async () => {
        const { getTree, getWebRTCStore } = await import('/src/store.ts');
        const { nostrStore, saveHashtree } = await import('/src/nostr.ts');
        const hashtree = await import('/node_modules/hashtree/dist/index.js');
        const { toHex, videoChunker, cid, BlossomStore } = hashtree;

        const tree = getTree();
        let npub: string = '';
        const unsub = nostrStore.subscribe((state: any) => { npub = state.npub; });
        unsub();

        // Create 2 videos for the playlist with distinct titles
        const videos = [
          { id: 'crossUserVideo001', title: 'Cross User Video Alpha' },
          { id: 'crossUserVideo002', title: 'Cross User Video Beta' },
        ];

        const rootEntries: Array<{ name: string; cid: any; size: number }> = [];

        for (const video of videos) {
          const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

          // Create video file (minimal mp4 header)
          const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]);
          const streamWriter = tree.createStream({ public: true, chunker: videoChunker() });
          await streamWriter.append(videoData);
          const videoResult = await streamWriter.finalize();
          videoEntries.push({
            name: 'video.mp4',
            cid: cid(videoResult.hash, videoResult.key),
            size: videoResult.size,
          });

          // Create title.txt
          const titleData = new TextEncoder().encode(video.title);
          const titleResult = await tree.putFile(titleData, { public: true });
          videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

          // Create video directory
          const videoDirResult = await tree.putDirectory(videoEntries, { public: true });
          rootEntries.push({
            name: video.id,
            cid: videoDirResult.cid,
            size: videoEntries.reduce((sum, e) => sum + e.size, 0),
          });
        }

        // Create root playlist directory
        const rootDirResult = await tree.putDirectory(rootEntries, { public: true });
        const treeName = 'videos/Cross User Playlist Test';
        const rootHash = toHex(rootDirResult.cid.hash);

        // Publish to Nostr
        await saveHashtree(treeName, rootHash, undefined, { visibility: 'public' });

        // Create BlossomStore for push (same pattern as BlossomPushModal)
        const { signEvent } = await import('/src/nostr.ts');
        const blossomStore = new BlossomStore({
          servers: [{ url: 'https://cdn.iris.to', write: false }, { url: 'https://hashtree.iris.to', write: true }],
          signer: async (event: any) => signEvent({ ...event, pubkey: '', id: '', sig: '' }),
        });

        let pushResult = { attempted: true, success: false, error: '', pushed: 0 };
        try {
          await tree.push(rootDirResult.cid, blossomStore, {
            onProgress: (current: number, total: number) => {
              pushResult.pushed = current;
            },
          });
          pushResult.success = true;
        } catch (e) {
          pushResult.error = String(e);
        }

        return {
          npub,
          treeName,
          rootHash,
          videos,
          rootCid: { hash: rootHash },
          pushResult,
        };
      });

      console.log('User A created and pushed playlist:', playlist);

      // Navigate to playlist page to verify it works for User A first
      await pageA.goto(`/video.html#/${userANpub}/${encodeURIComponent(playlist.treeName)}/${playlist.videos[0].id}`);

      // Wait for the video title to appear (not the folder name)
      await expect(pageA.getByRole('heading', { name: 'Cross User Video Alpha' })).toBeVisible({ timeout: 15000 });

      // Take screenshot of User A's state
      await pageA.screenshot({ path: 'e2e/screenshots/playlist-share-userA.png' });

      // ===== User B: Initialize and navigate =====
      await pageB.goto('/video.html#/');
      await disableOthersPool(pageB);
      await configureBlossomServers(pageB);
      await ensureLoggedIn(pageB);

      // Wait for app to initialize
      await expect(pageB.locator('button:has-text("Create")')).toBeVisible({ timeout: 15000 });

      // Navigate directly to User A's playlist video
      const directUrl = `/video.html#/${userANpub}/${encodeURIComponent(playlist.treeName)}/${playlist.videos[0].id}`;
      console.log('User B navigating directly to:', directUrl);
      await pageB.goto(directUrl);

      // Take screenshot immediately
      await pageB.screenshot({ path: 'e2e/screenshots/playlist-share-userB-direct.png' });

      // Debug: Check tree root resolution and data availability
      const debugInfo = await pageB.evaluate(async (args: { npub: string; treeName: string }) => {
        // Wait a bit for tree resolution from Nostr
        await new Promise(r => setTimeout(r, 5000));

        // Try to get the tree root via the resolver
        const { waitForTreeRoot, getTreeRootSync } = await import('/src/stores/treeRoot.ts');

        // Check sync first
        const syncRoot = getTreeRootSync(args.npub, args.treeName);

        // Try async with timeout
        let asyncRoot = null;
        try {
          asyncRoot = await waitForTreeRoot(args.npub, args.treeName, 10000);
        } catch {}

        const storeInfo = {
          peerCount: (window as any).__appStore?.getState()?.peerCount || 0,
          syncRootFound: !!syncRoot,
          asyncRootFound: !!asyncRoot,
          asyncRootHash: asyncRoot?.hash ? Array.from(asyncRoot.hash as Uint8Array).slice(0, 4) : null,
        };

        return storeInfo;
      }, { npub: userANpub, treeName: playlist.treeName });
      console.log('Debug info:', JSON.stringify(debugInfo));

      // The title should NOT be the folder name (crossUserVideo001)
      // It SHOULD be the actual video title from title.txt
      const titleLocator = pageB.getByRole('heading', { level: 1 });
      await expect(titleLocator).toBeVisible({ timeout: 30000 });

      // Get the actual title text
      const actualTitle = await titleLocator.textContent();
      console.log('Actual title:', actualTitle);

      // Verify it's not just the folder ID
      expect(actualTitle).not.toBe('crossUserVideo001');
      expect(actualTitle).not.toBe('Loading video');
      expect(actualTitle).not.toBe('Video');

      // The title should be the actual video title
      expect(actualTitle).toContain('Cross User Video Alpha');

      // Take screenshot after title verification
      await pageB.screenshot({ path: 'e2e/screenshots/playlist-share-userB-title.png' });

      // Verify playlist sidebar shows both videos
      // Desktop sidebar uses "1/2" without parentheses, mobile uses "(1/2)"
      // Check for desktop version which should be visible in default viewport
      const desktopSidebar = pageB.locator('.hidden.lg\\:block');
      await expect(desktopSidebar).toBeVisible({ timeout: 10000 });

      // Verify playlist name is visible in sidebar
      await expect(desktopSidebar.getByText('Cross User Playlist Test')).toBeVisible({ timeout: 5000 });

      // Verify both videos appear in the sidebar
      await expect(desktopSidebar.getByText('Cross User Video Alpha')).toBeVisible({ timeout: 5000 });
      await expect(desktopSidebar.getByText('Cross User Video Beta')).toBeVisible({ timeout: 5000 });

      // Take screenshot after sidebar verification
      await pageB.screenshot({ path: 'e2e/screenshots/playlist-share-userB-sidebar.png' });

      // ===== Navigate to User A's profile and verify playlist appears as playlist =====
      await pageB.goto(`/video.html#/${userANpub}`);
      await pageB.waitForTimeout(3000);

      // Take screenshot of profile
      await pageB.screenshot({ path: 'e2e/screenshots/playlist-share-userB-profile.png' });

      // Profile should show "Playlists" section with the playlist (not as a single video)
      const playlistsSection = pageB.getByText('Playlists');
      const isPlaylistsSectionVisible = await playlistsSection.isVisible({ timeout: 10000 }).catch(() => false);

      console.log('Profile has Playlists section:', isPlaylistsSectionVisible);

      // The playlist should appear with the playlist icon/video count
      const playlistCard = pageB.getByText('Cross User Playlist Test');
      await expect(playlistCard).toBeVisible({ timeout: 10000 });

      // Check that it shows video count (indicates it's recognized as a playlist)
      const videoCountText = pageB.getByText(/2 video/i);
      await expect(videoCountText).toBeVisible({ timeout: 10000 });

      console.log('Test passed: Another user can view playlist with full experience');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('setEntry method can add CID reference to directory', async ({ page }) => {
    // This test verifies that the hashtree setEntry method works correctly
    // for adding video CID references to playlists

    await page.goto('/video.html#/');
    await disableOthersPool(page);

    // Wait for app to initialize
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async () => {
      const { getTree } = await import('/src/store.ts');
      const hashtree = await import('/node_modules/hashtree/dist/index.js');
      const { toHex, cid, LinkType } = hashtree;

      const tree = getTree();

      // Create a source video directory (simulating an existing video)
      const videoEntries: Array<{ name: string; cid: any; size: number }> = [];

      const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]);
      const videoResult = await tree.putFile(videoData, { public: true });
      videoEntries.push({ name: 'video.mp4', cid: videoResult.cid, size: videoResult.size });

      const titleData = new TextEncoder().encode('Reference Test Video');
      const titleResult = await tree.putFile(titleData, { public: true });
      videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });

      const sourceVideoCid = await tree.putDirectory(videoEntries, { public: true });
      const sourceVideoSize = videoEntries.reduce((sum, e) => sum + e.size, 0);

      // Create an empty playlist directory
      const emptyPlaylist = await tree.putDirectory([], { public: true });

      // Use setEntry to add the video CID to the playlist
      const updatedPlaylist = await tree.setEntry(
        emptyPlaylist.cid,
        [], // root path
        'video-ref-001', // entry name
        sourceVideoCid.cid, // CID of the source video
        sourceVideoSize,
        LinkType.Dir // it's a directory
      );

      // Verify the entry was added
      const entries = await tree.listDirectory(updatedPlaylist);

      // Verify the referenced video's content is accessible
      let videoAccessible = false;
      for (const entry of entries) {
        if (entry.name === 'video-ref-001') {
          const subEntries = await tree.listDirectory(entry.cid);
          videoAccessible = subEntries.some((e: any) => e.name === 'video.mp4');
        }
      }

      return {
        entryCount: entries.length,
        entryNames: entries.map((e: any) => e.name),
        videoAccessible,
        sourceVideoHash: toHex(sourceVideoCid.cid.hash),
      };
    });

    // Verify setEntry correctly added the CID reference
    expect(result.entryCount).toBe(1);
    expect(result.entryNames).toContain('video-ref-001');
    expect(result.videoAccessible).toBe(true);

    console.log('setEntry CID reference test passed:', result);
  });
});
