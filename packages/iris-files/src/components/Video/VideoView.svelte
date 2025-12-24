<script lang="ts">
  /**
   * VideoView - Video player page
   * Shows video player, metadata, owner info, and comments
   *
   * Uses Service Worker streaming via /htree/ URLs (no blob URLs!)
   */
  import { untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { getTree } from '../../store';
  import { ndk, nostrStore } from '../../nostr';
  import { treeRootStore, createTreesStore } from '../../stores';
  import { openShareModal, openBlossomPushModal, openAddToPlaylistModal } from '../../stores/modals';
  import type { TreeVisibility } from 'hashtree';
  import { deleteTree } from '../../nostr';
  import { updateLocalRootCacheHex } from '../../treeRootCache';
  import { addRecent, updateVideoPosition, getVideoPosition, clearVideoPosition, updateRecentLabel } from '../../stores/recents';
  import { Avatar, Name } from '../User';
  import { Truncate } from '../ui';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import VideoComments from './VideoComments.svelte';
  import PlaylistSidebar from './PlaylistSidebar.svelte';
  import { getFollowers, socialGraphStore } from '../../utils/socialGraph';
  import { currentPlaylist, loadPlaylist, playNext, repeatMode, shuffleEnabled } from '../../stores/playlist';
  import type { CID, LinkType } from 'hashtree';
  import { toHex, nhashEncode } from 'hashtree';
  import { getNpubFileUrl, getNhashFileUrl } from '../../lib/mediaUrl';
  import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';

  let deleting = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let editTitle = $state('');
  let editDescription = $state('');

  // Like state
  let likes = $state<Set<string>>(new Set()); // Set of pubkeys who liked
  let userLiked = $state(false);
  let liking = $state(false);

  // Playlist state
  let showPlaylistSidebar = $state(true);
  let playlist = $derived($currentPlaylist);
  let repeat = $derived($repeatMode);
  let shuffle = $derived($shuffleEnabled);

  interface Props {
    npub?: string;
    videoName?: string;  // Legacy prop
    wild?: string;       // Wildcard capture from router (e.g., "Channel/videoId")
  }

  let { npub, videoName, wild }: Props = $props();

  // 'wild' contains the full path after /videos/ (can include slashes)
  // For single videos: "VideoTitle" → treeName = "videos/VideoTitle"
  // For playlist videos: "ChannelName/videoId" → treeName = "videos/ChannelName", videoId = "videoId"
  let videoPath = $derived(wild || videoName || '');
  let pathParts = $derived(videoPath.split('/'));
  let isPlaylistVideo = $derived(pathParts.length > 1);

  // For playlists, the tree is the channel (parent), not the full path
  let channelName = $derived(isPlaylistVideo ? pathParts.slice(0, -1).join('/') : null);
  let currentVideoId = $derived(isPlaylistVideo ? pathParts[pathParts.length - 1] : null);

  // The actual tree name to resolve
  // - Single video: videos/VideoTitle
  // - Playlist video: videos/ChannelName (the video is a subdirectory within)
  let treeName = $derived.by(() => {
    if (!videoPath) return undefined;
    if (isPlaylistVideo && channelName) {
      return `videos/${channelName}`;
    }
    return `videos/${videoPath}`;
  });

  // For playlist sidebar loading
  let parentTreeName = $derived(isPlaylistVideo ? treeName : null);

  let videoSrc = $state<string>('');  // SW URL (not blob!)
  let videoFileName = $state<string>('');  // For MIME type detection
  let loading = $state(true);
  let showLoading = $state(false);  // Delayed loading indicator
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;
  let error = $state<string | null>(null);
  let videoTitle = $state<string>('');
  let videoDescription = $state<string>('');
  let videoCid = $state<CID | null>(null);  // CID of the video FILE (video.mp4)
  let videoFolderCid = $state<CID | null>(null);  // CID of the video FOLDER (contains video.mp4, title.txt, etc.)
  let videoVisibility = $state<TreeVisibility>('public');
  let videoRef: HTMLVideoElement | undefined = $state();

  // Full video path for position tracking (includes npub)
  let videoFullPath = $derived(npub && treeName ? `/${npub}/${treeName}` : null);

  // Restore position when video loads
  function handleLoadedMetadata() {
    if (!videoRef || !videoFullPath) return;
    const savedPosition = getVideoPosition(videoFullPath);
    if (savedPosition > 0 && videoRef.duration > savedPosition) {
      videoRef.currentTime = savedPosition;
      console.log('[VideoView] Restored position:', savedPosition);
    }
  }

  // Save position on timeupdate
  function handleTimeUpdate() {
    if (!videoRef || !videoFullPath) return;
    updateVideoPosition(videoFullPath, videoRef.currentTime);
  }

  // Clear position when video ends and handle auto-play/repeat
  function handleEnded() {
    if (videoFullPath) {
      clearVideoPosition(videoFullPath);
    }

    // Handle repeat mode
    if (repeat === 'one') {
      // Repeat current video
      if (videoRef) {
        videoRef.currentTime = 0;
        videoRef.play();
      }
      return;
    }

    // Auto-play next video (always enabled for playlists, like YouTube)
    if (playlist && playlist.items.length > 1) {
      // Check if we're at the end and repeat is off
      const isLastVideo = playlist.currentIndex === playlist.items.length - 1;
      const shouldWrap = repeat === 'all' || shuffle;

      if (isLastVideo && !shouldWrap && !shuffle) {
        // End of playlist, repeat off, not shuffling - stop
        console.log('[VideoView] End of playlist, stopping');
        return;
      }

      const nextUrl = playNext({ wrap: shouldWrap });
      if (nextUrl) {
        console.log('[VideoView] Auto-playing next video');
        window.location.hash = nextUrl;
      }
    }
  }

  // Derive owner pubkey
  let ownerPubkey = $derived.by(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {}
    return null;
  });

  // Video title from title.txt or video path (last segment for playlists)
  let title = $derived(videoTitle || currentVideoId || videoPath || 'Video');

  // Current user
  let currentUserNpub = $derived($nostrStore.npub);
  let userPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let isOwner = $derived(npub === currentUserNpub);

  // Social graph for known followers (like YouTube subscriber count)
  let graphVersion = $derived($socialGraphStore.version);
  let knownFollowers = $derived.by(() => {
    graphVersion; // Subscribe to changes
    return ownerPubkey ? getFollowers(ownerPubkey) : new Set();
  });

  // Get root CID from treeRootStore (handles linkKey decryption)
  let rootCid = $derived($treeRootStore);

  // Generate nhash for permalink - uses video file CID (not root dir) so same content = same link
  let videoNhash = $derived.by(() => {
    if (!videoCid) return undefined;
    return nhashEncode(videoCid);
  });

  // Subscribe to trees store to get visibility
  $effect(() => {
    const currentNpub = npub;
    const currentTreeName = treeName;
    if (!currentNpub || !currentTreeName) return;

    const store = createTreesStore(currentNpub);
    const unsub = store.subscribe(trees => {
      const tree = trees.find(t => t.name === currentTreeName);
      if (tree?.visibility) {
        untrack(() => {
          videoVisibility = tree.visibility as TreeVisibility;
        });
      }
    });
    return unsub;
  });

  // Load video when rootCid or videoPath changes
  // For playlist videos, rootCid is the same but videoPath changes
  $effect(() => {
    const cid = rootCid;
    const path = videoPath; // Subscribe to videoPath changes
    const isPlaylist = isPlaylistVideo; // Capture reactively
    if (cid) {
      // Reset state for new video
      videoSrc = '';
      videoTitle = '';
      videoDescription = '';
      loading = true;
      error = null;

      // Clear playlist if navigating to a non-playlist video
      if (!isPlaylist) {
        untrack(() => {
          currentPlaylist.set(null);
        });
      }

      untrack(() => loadVideo(cid));
    }
  });

  // Delayed loading indicator - only show after 2 seconds
  $effect(() => {
    if (!loading) {
      // Video loaded - clear timer and hide loading
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      showLoading = false;
    } else if (!loadingTimer && !showLoading) {
      // Still loading - start timer to show indicator
      loadingTimer = setTimeout(() => {
        showLoading = true;
        loadingTimer = null;
      }, 2000);
    }

    return () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    };
  });

  // No blob URL cleanup needed - using SW URLs

  async function loadVideo(rootCidParam: CID) {
    if (!npub || !treeName) return;

    error = null;

    const tree = getTree();

    // For playlist videos, we need to first navigate to the video subdirectory
    let videoDirCid = rootCidParam;
    let videoPathPrefix = '';

    if (isPlaylistVideo && currentVideoId) {
      // Navigate to the video subdirectory within the playlist
      try {
        const videoDir = await tree.resolvePath(rootCidParam, currentVideoId);
        if (videoDir) {
          videoDirCid = videoDir.cid;
          videoPathPrefix = `${currentVideoId}/`;
        } else {
          error = `Video "${currentVideoId}" not found in playlist`;
          loading = false;
          return;
        }
      } catch (e) {
        error = `Failed to load video: ${e}`;
        loading = false;
        return;
      }
    }

    // Store the video folder CID (for adding to other playlists)
    videoFolderCid = videoDirCid;

    // Try common video filenames immediately (don't wait for directory listing)
    const commonNames = ['video.webm', 'video.mp4', 'video.mov'];
    for (const name of commonNames) {
      try {
        const result = await tree.resolvePath(videoDirCid, name);
        if (result) {
          videoCid = result.cid;
          videoFileName = name;
          videoSrc = getNpubFileUrl(npub, treeName, videoPathPrefix + name);
          loading = false;
          break;
        }
      } catch {}
    }

    // If common names didn't work, list directory to find video
    if (!videoSrc) {
      try {
        const dir = await tree.listDirectory(videoDirCid);
        const videoEntry = dir?.find(e =>
          e.name.startsWith('video.') ||
          e.name.endsWith('.webm') ||
          e.name.endsWith('.mp4') ||
          e.name.endsWith('.mov')
        );

        if (videoEntry) {
          const videoResult = await tree.resolvePath(videoDirCid, videoEntry.name);
          if (videoResult) {
            videoCid = videoResult.cid;
            videoFileName = videoEntry.name;
            videoSrc = getNpubFileUrl(npub, treeName, videoPathPrefix + videoEntry.name);
            loading = false;
          }
        }
      } catch {}
    }

    // If still no video and NOT a playlist video, check if this is a playlist directory root
    if (!videoSrc && !isPlaylistVideo) {
      try {
        const dir = await tree.listDirectory(rootCidParam);
        if (dir && dir.length > 0) {
          // Collect all video directories
          const videoEntries: { name: string }[] = [];
          for (const entry of dir) {
            try {
              const subDir = await tree.listDirectory(entry.cid);
              const hasVideo = subDir?.some(e =>
                e.name.startsWith('video.') ||
                e.name.endsWith('.webm') ||
                e.name.endsWith('.mp4') ||
                e.name.endsWith('.mkv')
              );
              if (hasVideo) {
                videoEntries.push({ name: entry.name });
              }
            } catch {
              // Not a directory, continue
            }
          }

          if (videoEntries.length > 0) {
            // Sort alphabetically to match playlist order
            videoEntries.sort((a, b) => a.name.localeCompare(b.name));

            // Pick first video, or random if shuffle is on
            const startIndex = shuffle && videoEntries.length > 1
              ? Math.floor(Math.random() * videoEntries.length)
              : 0;
            const startVideoId = videoEntries[startIndex].name;
            const playlistUrl = `#/${npub}/${encodeURIComponent(treeName)}/${encodeURIComponent(startVideoId)}`;
            console.log('[VideoView] Detected playlist, navigating to video:', playlistUrl);
            window.location.hash = playlistUrl;
            return;
          }
        }
      } catch {}
    }

    if (!videoSrc) {
      error = 'Video file not found';
      loading = false;
      return;
    }

    // Add to recents - use full path for playlist videos
    // Compute recentPath first so we can pass it to loadMetadata
    const recentPath = npub && treeName
      ? (isPlaylistVideo && currentVideoId
        ? `/${npub}/${treeName}/${currentVideoId}`
        : `/${npub}/${treeName}`)
      : null;

    if (recentPath) {
      addRecent({
        type: 'tree',
        path: recentPath,
        label: videoTitle || currentVideoId || videoPath || 'Video',
        npub: npub!,
        treeName: treeName!,
        videoId: isPlaylistVideo ? currentVideoId : undefined,
        visibility: videoVisibility,
      });
    }

    // Load metadata in background (don't block video playback)
    // For playlist videos, load from the video subdirectory
    // Pass recentPath so we can update the label when title loads
    loadMetadata(videoDirCid, tree, recentPath || undefined);

    // Load playlist if this is a playlist video
    if (isPlaylistVideo && treeName && npub && rootCidParam) {
      loadPlaylistForVideo(rootCidParam);
    }
  }

  /** Load playlist from parent directory */
  async function loadPlaylistForVideo(playlistRootCid: CID) {
    if (!treeName || !npub || !currentVideoId) return;

    console.log('[VideoView] Loading playlist for video:', currentVideoId, 'from', treeName);

    // Load the playlist using the already-resolved root CID (don't resolve again)
    const result = await loadPlaylist(npub, treeName, playlistRootCid, currentVideoId);

    if (result) {
      console.log('[VideoView] Loaded playlist with', result.items.length, 'videos');
    }
  }

  /** Load title and description in background */
  async function loadMetadata(rootCid: CID, tree: ReturnType<typeof getTree>, recentPath?: string) {
    // Load title.txt
    try {
      const titleResult = await tree.resolvePath(rootCid, 'title.txt');
      if (titleResult) {
        const titleData = await tree.readFile(titleResult.cid);
        if (titleData) {
          videoTitle = new TextDecoder().decode(titleData);
          // Update recent label with loaded title
          if (recentPath && videoTitle) {
            updateRecentLabel(recentPath, videoTitle);
          }
        }
      }
    } catch {}

    // Load description.txt
    try {
      const descResult = await tree.resolvePath(rootCid, 'description.txt');
      if (descResult) {
        const descData = await tree.readFile(descResult.cid);
        if (descData) {
          videoDescription = new TextDecoder().decode(descData);
        }
      }
    } catch {}
  }

  function handleShare() {
    const url = window.location.href;
    openShareModal(url);
  }

  function handlePermalink() {
    if (!videoNhash) return;
    // Navigate to the nhash permalink (video file CID)
    window.location.hash = `#/${videoNhash}`;
  }

  function handleDownload() {
    if (!videoCid || !videoFileName) return;
    // Navigate to SW URL with ?download=1 query param
    // SW will serve with Content-Disposition: attachment header for streaming download
    const swUrl = getNhashFileUrl(videoCid, videoFileName) + '?download=1';
    window.location.href = swUrl;
  }

  function handleBlossomPush() {
    if (!rootCid) return;
    openBlossomPushModal(rootCid, title, true);
  }

  function handleSaveToPlaylist() {
    // Use videoFolderCid which is the video folder (contains video.mp4, title.txt, etc.)
    // For single videos: videoFolderCid = rootCid (the video tree root)
    // For playlist videos: videoFolderCid = the specific video subfolder
    const cidToSave = videoFolderCid || rootCid;
    if (!cidToSave) return;
    // Estimate size (we don't have exact size, but it's not critical)
    openAddToPlaylistModal(cidToSave, title, 0);
  }

  async function handleDelete() {
    if (!treeName || deleting) return;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    deleting = true;
    try {
      if (isPlaylistVideo && currentVideoId && rootCid) {
        // Delete only this video from the playlist (not the whole playlist)
        await deletePlaylistVideo();
      } else {
        // Delete the entire tree (single video)
        await deleteTree(treeName);
        window.location.hash = '#/';
      }
    } catch (e) {
      console.error('Failed to delete video:', e);
      alert('Failed to delete video');
      deleting = false;
    }
  }

  /**
   * Delete a single video from a playlist without removing the whole playlist
   */
  async function deletePlaylistVideo() {
    if (!npub || !treeName || !currentVideoId || !rootCid) return;

    const tree = getTree();

    // Get the current playlist root CID (the parent directory)
    const { getLocalRootCache, getLocalRootKey } = await import('../../treeRootCache');
    const playlistRootHash = getLocalRootCache(npub, treeName);
    if (!playlistRootHash) {
      throw new Error('Playlist root not found');
    }

    const playlistRootKey = getLocalRootKey(npub, treeName);
    const playlistCid = playlistRootKey
      ? { hash: playlistRootHash, key: playlistRootKey }
      : { hash: playlistRootHash };

    // Remove the video entry from the playlist
    const newPlaylistCid = await tree.removeEntry(playlistCid, [], currentVideoId);

    // Check how many videos remain (directories containing videos)
    const remainingEntries = await tree.listDirectory(newPlaylistCid);
    // Filter for directories - type can be LinkType.Dir (2) or check by inspecting contents
    const remainingVideos: typeof remainingEntries = [];
    for (const entry of remainingEntries) {
      try {
        // Try to list as directory - if it works, it's a directory
        const subEntries = await tree.listDirectory(entry.cid);
        const hasVideo = subEntries?.some(e =>
          e.name.startsWith('video.') ||
          e.name.endsWith('.mp4') ||
          e.name.endsWith('.webm') ||
          e.name.endsWith('.mkv')
        );
        if (hasVideo) {
          remainingVideos.push(entry);
        }
      } catch {
        // Not a directory, skip
      }
    }

    if (remainingVideos.length === 0) {
      // No videos left - delete the whole playlist
      await deleteTree(treeName);
      window.location.hash = '#/';
    } else {
      // Update the playlist root with the new CID
      updateLocalRootCacheHex(
        npub,
        treeName,
        toHex(newPlaylistCid.hash),
        newPlaylistCid.key ? toHex(newPlaylistCid.key) : undefined,
        videoVisibility
      );

      // Clear the current playlist from store to force reload
      const { clearPlaylist } = await import('../../stores/playlist');
      clearPlaylist();

      // Navigate to the next video in the playlist
      const nextVideoId = remainingVideos[0].name;
      window.location.hash = `#/${npub}/${encodeURIComponent(treeName)}/${encodeURIComponent(nextVideoId)}`;
    }
  }

  function startEdit() {
    editTitle = videoTitle || videoName || '';
    editDescription = videoDescription || '';
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    editTitle = '';
    editDescription = '';
  }

  async function saveEdit() {
    if (!npub || !treeName || saving) return;
    if (!editTitle.trim()) {
      alert('Title is required');
      return;
    }

    saving = true;
    try {
      let currentRootCid = rootCid;
      if (!currentRootCid) throw new Error('Video not found');

      const tree = getTree();
      const isPublic = videoVisibility === 'public';

      // Update title.txt
      const titleData = new TextEncoder().encode(editTitle.trim());
      const titleResult = await tree.putFile(titleData, { public: isPublic });
      currentRootCid = await tree.setEntry(currentRootCid, [], 'title.txt', titleResult.cid, titleResult.size, 0 as LinkType);

      // Update description.txt (or remove if empty)
      if (editDescription.trim()) {
        const descData = new TextEncoder().encode(editDescription.trim());
        const descResult = await tree.putFile(descData, { public: isPublic });
        currentRootCid = await tree.setEntry(currentRootCid, [], 'description.txt', descResult.cid, descResult.size, 0 as LinkType);
      } else {
        // Remove description if it exists and is now empty
        try {
          currentRootCid = await tree.removeEntry(currentRootCid, [], 'description.txt');
        } catch {}
      }

      // Save and publish
      updateLocalRootCacheHex(
        npub,
        treeName,
        toHex(currentRootCid.hash),
        currentRootCid.key ? toHex(currentRootCid.key) : undefined,
        videoVisibility
      );

      // Update local state
      videoTitle = editTitle.trim();
      videoDescription = editDescription.trim();
      editing = false;
    } catch (e) {
      console.error('Failed to save:', e);
      alert('Failed to save changes');
    } finally {
      saving = false;
    }
  }


  // Video identifier for reactions (npub/treeName format - path to video directory)
  // For playlist videos, include the videoId to target the specific video, not the whole playlist
  let videoIdentifier = $derived.by(() => {
    if (!npub || !treeName) return null;
    // For playlist videos, include the video folder ID in the identifier
    if (isPlaylistVideo && currentVideoId) {
      return `${npub}/${treeName}/${currentVideoId}`;
    }
    return `${npub}/${treeName}`;
  });

  // Subscribe to likes for this video
  $effect(() => {
    const identifier = videoIdentifier;
    const currentUserPubkey = userPubkey; // Capture for callback
    if (!identifier) return;

    // Reset state
    untrack(() => {
      likes = new Set();
      userLiked = false;
    });

    // Subscribe to kind 17 reactions with our identifier
    const filter: NDKFilter = {
      kinds: [17 as number],
      '#i': [identifier],
    };

    const sub = ndk.subscribe(filter, { closeOnEose: false });

    sub.on('event', (event: NDKEvent) => {
      if (!event.pubkey) return;

      // Check if it's a like (+ or empty content)
      const content = event.content?.trim() || '+';
      if (content === '+' || content === '') {
        untrack(() => {
          likes = new Set([...likes, event.pubkey]);

          // Check if current user liked
          if (event.pubkey === currentUserPubkey) {
            userLiked = true;
          }
        });
      }
    });

    return () => {
      sub.stop();
    };
  });

  // Toggle like
  async function toggleLike() {
    if (!videoIdentifier || !isLoggedIn || liking) return;

    liking = true;
    try {
      const event = new NDKEvent(ndk);
      event.kind = 17; // External content reaction
      event.content = userLiked ? '' : '+'; // Toggle (note: can't really "unlike" in Nostr, but we track locally)

      // Build tags - include both npub path and nhash for discoverability
      const tags: string[][] = [
        ['i', videoIdentifier],
        ['k', 'video'],
      ];

      // Add nhash identifier for permalink reactions (uses video file CID, not directory)
      // Plain nhash is sufficient since it points directly to the file content
      if (videoNhash) {
        tags.push(['i', videoNhash]);
      }

      // Add p tag if we know the owner
      if (ownerPubkey) {
        tags.push(['p', ownerPubkey]);
      }

      event.tags = tags;

      await event.sign();
      await event.publish();

      // Update local state optimistically
      if (!userLiked) {
        likes = new Set([...likes, userPubkey!]);
        userLiked = true;
      }
    } catch (e) {
      console.error('Failed to like video:', e);
    } finally {
      liking = false;
    }
  }
</script>

<div class="flex flex-1 overflow-hidden">
  <!-- Main content area -->
  <div class="flex-1 overflow-auto">
    <!-- Video Player - full width, sensible height like YouTube -->
    <div class="w-full max-w-full bg-black overflow-hidden mx-auto" style="height: min(calc(100vh - 48px - 80px), 90vh); aspect-ratio: 16/9;">
    {#if loading && showLoading}
      <div class="w-full h-full flex items-center justify-center text-white text-sm">
        Loading video...
      </div>
    {:else if error}
      <div class="w-full h-full flex items-center justify-center text-red-400">
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {:else if videoSrc}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoRef}
        src={videoSrc}
        controls
        autoplay
        playsinline
        class="w-full h-full"
        preload="metadata"
        onloadedmetadata={handleLoadedMetadata}
        ontimeupdate={handleTimeUpdate}
        onended={handleEnded}
      >
        Your browser does not support the video tag.
      </video>
    {/if}
  </div>

  <!-- Content below video -->
  <div class="max-w-5xl mx-auto px-4 py-4">
    <!-- Video Info -->
    <div class="mb-6">
      {#if editing}
        <!-- Edit form -->
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-text-2 mb-1">Title</label>
            <input
              type="text"
              bind:value={editTitle}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
              placeholder="Video title"
              disabled={saving}
            />
          </div>
          <div>
            <label class="block text-sm text-text-2 mb-1">Description</label>
            <textarea
              bind:value={editDescription}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 resize-none focus:border-accent focus:outline-none"
              placeholder="Video description..."
              rows="3"
              disabled={saving}
            ></textarea>
          </div>
          <div class="flex gap-2">
            <button onclick={saveEdit} class="btn-primary px-4 py-2" disabled={saving || !editTitle.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onclick={cancelEdit} class="btn-ghost px-4 py-2" disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="flex items-start justify-between gap-4 mb-3">
          <h1 class="text-xl font-semibold text-text-1 break-words min-w-0">{title}</h1>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end">
            <!-- Like button -->
            {#if videoIdentifier}
              <button
                onclick={toggleLike}
                class="btn-ghost p-2 flex items-center gap-1"
                class:text-accent={userLiked}
                title={userLiked ? 'Liked' : 'Like'}
                disabled={!isLoggedIn || liking}
              >
                <span class={userLiked ? 'i-lucide-heart text-lg' : 'i-lucide-heart text-lg'} class:fill-current={userLiked}></span>
                {#if likes.size > 0}
                  <span class="text-sm">{likes.size}</span>
                {/if}
              </button>
            {/if}
            <!-- Save to playlist button -->
            {#if isLoggedIn}
              <button
                onclick={handleSaveToPlaylist}
                class="btn-ghost p-2"
                title="Add to playlist"
                disabled={!rootCid}
              >
                <span class="i-lucide-bookmark text-lg"></span>
              </button>
            {/if}
            <button onclick={handleShare} class="btn-ghost p-2" title="Share">
              <span class="i-lucide-share text-lg"></span>
            </button>
            <button onclick={handlePermalink} class="btn-ghost p-2" title="Permalink (content-addressed)" disabled={!videoNhash}>
              <span class="i-lucide-link text-lg"></span>
            </button>
            <button onclick={handleDownload} class="btn-ghost p-2" title="Download" disabled={!videoCid}>
              <span class="i-lucide-download text-lg"></span>
            </button>
            {#if isOwner}
              <button onclick={handleBlossomPush} class="btn-ghost p-2" title="Push to file servers">
                <span class="i-lucide-upload-cloud text-lg"></span>
              </button>
              <button onclick={startEdit} class="btn-ghost p-2" title="Edit">
                <span class="i-lucide-pencil text-lg"></span>
              </button>
              <button
                onclick={handleDelete}
                class="btn-ghost p-2 text-red-400 hover:text-red-300"
                title="Delete video"
                disabled={deleting}
              >
                <span class={deleting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'} class:text-lg={true}></span>
              </button>
            {/if}
          </div>
        </div>

        <!-- Owner info -->
        <div class="flex items-center gap-3 mb-4">
          {#if ownerPubkey}
            <a href={`#/${npub}`} class="shrink-0">
              <Avatar pubkey={ownerPubkey} size={40} />
            </a>
            <div class="min-w-0">
              <a href={`#/${npub}`} class="text-text-1 font-medium hover:text-accent no-underline">
                <Name pubkey={ownerPubkey} />
              </a>
              <div class="flex items-center gap-2 text-sm text-text-3">
                <span>{knownFollowers.size} known follower{knownFollowers.size !== 1 ? 's' : ''}</span>
                <span>·</span>
                <VisibilityIcon visibility={videoVisibility} class="text-xs" />
              </div>
            </div>
          {/if}
        </div>

        <!-- Description -->
        {#if videoDescription}
          <div class="bg-surface-1 rounded-lg p-4 text-text-2 text-sm">
            <Truncate text={videoDescription} maxLines={4} maxChars={400} />
          </div>
        {/if}
      {/if}
    </div>

    <!-- Mobile Playlist (horizontal scroll) -->
    {#if playlist && playlist.items.length > 1}
      <div class="lg:hidden mt-4">
        <PlaylistSidebar mobile={true} />
      </div>
    {/if}

    <!-- Comments -->
    {#if npub && treeName}
      {#key `${npub}/${treeName}/${currentVideoId || ''}`}
        <VideoComments {npub} {treeName} nhash={videoNhash} filename={videoFileName} />
      {/key}
    {/if}
  </div>
  </div>

  <!-- Desktop Playlist Sidebar -->
  {#if playlist && showPlaylistSidebar && playlist.items.length > 1}
    <div class="w-80 shrink-0 border-l border-surface-3 hidden lg:block">
      <PlaylistSidebar onClose={() => showPlaylistSidebar = false} />
    </div>
  {/if}
</div>
