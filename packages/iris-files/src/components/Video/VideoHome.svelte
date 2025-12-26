<script lang="ts">
  /**
   * VideoHome - Home page for video.iris.to
   * YouTube-style home with horizontal sections and infinite feed
   */
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { nip19 } from 'nostr-tools';
  import { ndk, nostrStore } from '../../nostr';
  import { recentsStore, clearRecentsByPrefix, type RecentItem } from '../../stores/recents';
  import { createFollowsStore } from '../../stores';
  import { getTree } from '../../store';
  import { getPlaylistCache, setPlaylistCache } from '../../stores/playlistCache';
  import { hasVideoFile, findThumbnailEntry, MIN_VIDEOS_FOR_STRUCTURE } from '../../utils/playlistDetection';
  import { SortedMap } from '../../utils/SortedMap';
  import type { CID } from 'hashtree';

  // Default pubkey to use for fallback content (sirius)
  const DEFAULT_CONTENT_PUBKEY = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
  const MIN_FOLLOWS_THRESHOLD = 5;
  import VideoCard from './VideoCard.svelte';
  import PlaylistCard from './PlaylistCard.svelte';
  import type { VideoItem } from './types';

  interface PlaylistInfo {
    videoCount: number;
    thumbnailUrl?: string;
  }

  /** Encode tree name for use in URL path */
  function encodeTreeNameForUrl(treeName: string): string {
    return encodeURIComponent(treeName);
  }

  // Get current user
  let userPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Track loading state for follows
  let followsLoading = $state(true);

  // Delay showing "no videos" to avoid flash during initial load
  let showEmptyState = $state(false);
  let emptyStateTimer: ReturnType<typeof setTimeout> | null = null;

  // Get recents and filter to only videos, deduped by normalized href
  let recents = $derived($recentsStore);
  let recentVideos = $derived(
    recents
      .filter(r => r.treeName?.startsWith('videos/'))
      .map(r => ({
        key: r.path,
        // For playlist videos (with videoId), use label; otherwise extract from treeName
        title: r.videoId ? r.label : (r.treeName ? r.treeName.slice(7) : r.label),
        ownerPubkey: r.npub ? npubToPubkey(r.npub) : null,
        ownerNpub: r.npub,
        treeName: r.treeName,
        videoId: r.videoId,
        visibility: r.visibility,
        href: buildRecentHref(r),
        timestamp: r.timestamp,
      } as VideoItem))
      .filter((v, i, arr) => arr.findIndex(x => x.href.normalize('NFC') === v.href.normalize('NFC')) === i)
      .slice(0, 10)
  );

  // Playlist detection for feed videos
  let feedPlaylistInfo = $state<Record<string, PlaylistInfo>>({});

  // Debounce playlist detection to avoid excessive calls
  let detectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingVideos: VideoItem[] = [];

  async function detectPlaylistsInFeed(videos: VideoItem[]) {
    // Merge with pending videos and debounce
    pendingVideos = [...pendingVideos, ...videos];
    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      const toProcess = pendingVideos;
      pendingVideos = [];
      detectTimer = null;
      doDetectPlaylists(toProcess);
    }, 100);
  }

  async function doDetectPlaylists(videos: VideoItem[]) {
    const tree = getTree();
    const newPlaylistInfo: Record<string, PlaylistInfo> = { ...feedPlaylistInfo };
    let changed = false;

    // Filter to videos that need detection
    const toDetect = videos.filter(video =>
      newPlaylistInfo[video.key] === undefined && video.hashHex && video.ownerNpub
    );

    // Check cache first (sync)
    for (const video of toDetect) {
      const cached = getPlaylistCache(video.ownerNpub!, video.treeName, video.hashHex!);
      if (cached) {
        if (cached.isPlaylist) {
          newPlaylistInfo[video.key] = { videoCount: cached.videoCount, thumbnailUrl: cached.thumbnailUrl };
        } else {
          newPlaylistInfo[video.key] = { videoCount: 0 };
        }
        changed = true;
      }
    }

    // Get videos that still need async detection
    const needsAsyncDetection = toDetect.filter(v => newPlaylistInfo[v.key] === undefined);

    // Process with limited concurrency
    const CONCURRENCY = 4;

    const detectOne = async (video: VideoItem): Promise<void> => {
      try {
        const hashBytes = new Uint8Array(video.hashHex!.match(/.{2}/g)!.map(b => parseInt(b, 16)));
        const rootCid: CID = { hash: hashBytes };

        const entries = await tree.listDirectory(rootCid);
        if (!entries || entries.length === 0) {
          setPlaylistCache(video.ownerNpub!, video.treeName, video.hashHex!, false, 0);
          newPlaylistInfo[video.key] = { videoCount: 0 };
          changed = true;
          return;
        }

        // Check subdirectories in parallel
        let videoCount = 0;
        let firstThumbnailUrl: string | undefined;

        const checkEntry = async (entry: typeof entries[0]): Promise<void> => {
          try {
            const subEntries = await tree.listDirectory(entry.cid);
            if (subEntries && hasVideoFile(subEntries)) {
              videoCount++;
              if (!firstThumbnailUrl) {
                const thumbEntry = findThumbnailEntry(subEntries);
                if (thumbEntry) {
                  firstThumbnailUrl = `/htree/${video.ownerNpub}/${encodeURIComponent(video.treeName)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(thumbEntry.name)}`;
                }
              }
            }
          } catch {
            // Not a directory
          }
        };

        await Promise.all(entries.map(checkEntry));

        // Cache and store the result
        const isPlaylist = videoCount >= MIN_VIDEOS_FOR_STRUCTURE;
        setPlaylistCache(video.ownerNpub!, video.treeName, video.hashHex!, isPlaylist, videoCount, firstThumbnailUrl);

        newPlaylistInfo[video.key] = { videoCount, thumbnailUrl: firstThumbnailUrl };
        changed = true;
      } catch {
        // Ignore errors
      }
    };

    // Process with limited concurrency
    const pending: Promise<void>[] = [];
    for (const video of needsAsyncDetection) {
      if (pending.length >= CONCURRENCY) {
        await Promise.race(pending);
        // Remove completed promises
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          // Check if promise is settled by racing with resolved promise
          const settled = await Promise.race([p.then(() => true), Promise.resolve(false)]);
          if (settled) pending.splice(i, 1);
        }
      }
      pending.push(detectOne(video));
    }
    await Promise.all(pending);

    if (changed) {
      feedPlaylistInfo = newPlaylistInfo;
    }
  }

  // Get user's follows
  let follows = $state<string[]>([]);

  // Fallback follows from default content pubkey (fetched directly, not via social graph)
  // Use a version counter to force reactivity
  let fallbackFollows = $state<string[]>([]);
  let fallbackVersion = $state(0);
  let fallbackFetched = false;

  // Compute effective follows: user's follows + fallback if < threshold
  let effectiveFollows = $derived.by(() => {
    // Track fallbackVersion to force re-computation when fallback is fetched
    void fallbackVersion;

    // If user has enough follows, use them directly
    if (follows.length >= MIN_FOLLOWS_THRESHOLD) {
      return follows;
    }

    // Otherwise, augment with default pubkey + its follows
    const combined = new SvelteSet(follows);
    combined.add(DEFAULT_CONTENT_PUBKEY); // Include the default user itself
    fallbackFollows.forEach(pk => combined.add(pk));

    return Array.from(combined);
  });

  // Track if we're using fallback content
  let usingFallback = $derived(follows.length < MIN_FOLLOWS_THRESHOLD);

  // Fetch fallback follow list when needed (directly from nostr, not via social graph)
  $effect(() => {
    if (usingFallback && !fallbackFetched) {
      fallbackFetched = true;
      // Fetch kind 3 (contacts) event for default content pubkey directly
      ndk.fetchEvents({
        kinds: [3],
        authors: [DEFAULT_CONTENT_PUBKEY],
        limit: 1,
      }).then(events => {
        const eventsArray = Array.from(events);
        if (eventsArray.length > 0) {
          // Sort by created_at to get the latest
          const event = eventsArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
          const followPubkeys = event.tags
            .filter(t => t[0] === 'p' && t[1])
            .map(t => t[1]);
          // Update both the data and version to ensure reactivity
          fallbackFollows = followPubkeys;
          fallbackVersion++;
        }
      }).catch(err => {
        console.error('[VideoHome] Failed to fetch fallback follows:', err);
      });
    }
  });

  $effect(() => {
    // Track userPubkey to trigger re-run when it changes
    const pk = userPubkey;

    // Reset when userPubkey changes
    if (!pk) {
      untrack(() => {
        follows = [];
        followsLoading = false;
      });
      return;
    }

    untrack(() => { followsLoading = true; });
    const store = createFollowsStore(pk);
    const unsub = store.subscribe(value => {
      untrack(() => {
        follows = value?.follows || [];
        followsLoading = false;
      });
    });
    return unsub;
  });

  // Videos from followed users - single multi-author subscription
  let followedUsersVideos = $state<VideoItem[]>([]);
  let videoSubUnsub: (() => void) | null = null;

  // Videos liked or commented by followed users
  let socialVideos = $state<VideoItem[]>([]);
  let socialSubUnsub: (() => void) | null = null;

  $effect(() => {
    // Track effectiveFollows to trigger re-run when it changes (includes fallback)
    const currentFollows = effectiveFollows;
    // Track userPubkey to include own videos
    const myPubkey = userPubkey;

    // Clean up previous subscription
    untrack(() => {
      if (videoSubUnsub) {
        videoSubUnsub();
        videoSubUnsub = null;
      }
    });

    // Include self + follows (deduplicated)
    const pubkeysToCheck = new SvelteSet(currentFollows);
    if (myPubkey) {
      pubkeysToCheck.add(myPubkey);
    }

    if (pubkeysToCheck.size === 0) {
      untrack(() => { followedUsersVideos = []; });
      return;
    }

    // Convert to array of pubkeys (no limit - single subscription handles all)
    const authors = Array.from(pubkeysToCheck);

    // SortedMap for efficient sorted insertion (descending by timestamp)
    const videosByKey = new SortedMap<string, VideoItem>(
      (a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0)
    );

    // Debounce updates to batch rapid events (but render first one immediately)
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let hasRenderedOnce = false;
    const scheduleUpdate = () => {
      // Render immediately on first update for instant back-nav
      if (!hasRenderedOnce) {
        hasRenderedOnce = true;
        const allVideos = videosByKey.values();
        untrack(() => {
          followedUsersVideos = allVideos;
          detectPlaylistsInFeed(allVideos);
        });
        return;
      }
      if (updateTimer) return;
      updateTimer = setTimeout(() => {
        updateTimer = null;
        const allVideos = videosByKey.values();
        untrack(() => {
          followedUsersVideos = allVideos;
          detectPlaylistsInFeed(allVideos);
        });
      }, 50);
    };

    // Single subscription for all authors' hashtree events
    const sub = ndk.subscribe({
      kinds: [30078],
      authors,
      '#l': ['hashtree'],
    }, { closeOnEose: false });

    sub.on('event', (event) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (!dTag || !dTag.startsWith('videos/')) return;

      // Parse visibility from tags
      const hashTag = event.tags.find(t => t[0] === 'hash')?.[1];
      if (!hashTag) return; // Deleted tree

      const hasEncryptedKey = event.tags.some(t => t[0] === 'encryptedKey');
      const hasSelfEncryptedKey = event.tags.some(t => t[0] === 'selfEncryptedKey');
      const visibility = hasEncryptedKey ? 'unlisted' : (hasSelfEncryptedKey ? 'private' : 'public');

      // Only include public videos
      if (visibility !== 'public') return;

      const ownerPubkey = event.pubkey;
      const ownerNpub = pubkeyToNpub(ownerPubkey);
      if (!ownerNpub) return;

      const key = `${ownerNpub}/${dTag}`;
      const existing = videosByKey.get(key);

      // Only update if newer
      if (existing && existing.timestamp && existing.timestamp >= (event.created_at || 0)) {
        return;
      }

      videosByKey.set(key, {
        key,
        title: dTag.slice(7), // Remove 'videos/' prefix
        ownerPubkey,
        ownerNpub,
        treeName: dTag,
        hashHex: hashTag, // Store for playlist detection
        visibility,
        href: `#/${ownerNpub}/${encodeTreeNameForUrl(dTag)}`,
        timestamp: event.created_at || 0,
      });

      scheduleUpdate();
    });

    untrack(() => {
      videoSubUnsub = () => sub.stop();
    });

    return () => {
      sub.stop();
    };
  });

  // Subscribe to followed users' liked and commented videos
  $effect(() => {
    const currentFollows = effectiveFollows;

    // Clean up previous subscription
    untrack(() => {
      if (socialSubUnsub) {
        socialSubUnsub();
        socialSubUnsub = null;
      }
    });

    if (currentFollows.length === 0) {
      untrack(() => { socialVideos = []; });
      return;
    }

    const authors = currentFollows;

    // SortedMap for efficient sorted insertion (descending by timestamp)
    const videosByKey = new SortedMap<string, VideoItem>(
      (a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0)
    );
    // Track seen event IDs
    const seenEventIds = new SvelteSet<string>();

    // Debounce updates (but render first one immediately)
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let hasRenderedOnce = false;
    const scheduleSocialUpdate = () => {
      if (!hasRenderedOnce) {
        hasRenderedOnce = true;
        untrack(() => { socialVideos = videosByKey.values(); });
        return;
      }
      if (updateTimer) return;
      updateTimer = setTimeout(() => {
        updateTimer = null;
        untrack(() => { socialVideos = videosByKey.values(); });
      }, 50);
    };

    // Parse video identifier from 'i' tag and create VideoItem
    // Format: "npub.../videos%2FVideoName" or just "nhash..."
    function parseVideoFromIdentifier(identifier: string, reactorPubkey: string, timestamp: number): VideoItem | null {
      // Skip nhash-only identifiers for now (no profile info)
      if (identifier.startsWith('nhash')) return null;

      // Try to parse npub/treeName format
      const match = identifier.match(/^(npub1[a-z0-9]+)\/(.+)$/);
      if (!match) return null;

      const [, ownerNpub, encodedTreeName] = match;
      let treeName: string;
      try {
        treeName = decodeURIComponent(encodedTreeName);
      } catch {
        treeName = encodedTreeName;
      }

      if (!treeName.startsWith('videos/')) return null;

      const ownerPubkey = npubToPubkey(ownerNpub);
      if (!ownerPubkey) return null;

      const key = `${ownerNpub}/${treeName}`;
      return {
        key,
        title: treeName.slice(7), // Remove 'videos/' prefix
        ownerPubkey,
        ownerNpub,
        treeName,
        visibility: 'public',
        href: `#/${ownerNpub}/${encodeTreeNameForUrl(treeName)}`,
        timestamp,
        // Track who reacted for potential UI display
        reactorPubkey,
      };
    }

    // Subscribe to kind 17 (reactions/likes) with k=video tag
    const likesSub = ndk.subscribe({
      kinds: [17 as number],
      authors,
      '#k': ['video'],
    }, { closeOnEose: false });

    likesSub.on('event', (event) => {
      if (!event.id || seenEventIds.has(event.id)) return;
      seenEventIds.add(event.id);

      // Find 'i' tag with video identifier
      const iTag = event.tags.find(t => t[0] === 'i')?.[1];
      if (!iTag) return;

      const video = parseVideoFromIdentifier(iTag, event.pubkey, event.created_at || 0);
      if (!video) return;

      const existing = videosByKey.get(video.key);
      // Keep the most recent interaction timestamp
      if (!existing || (video.timestamp && video.timestamp > (existing.timestamp || 0))) {
        videosByKey.set(video.key, video);
        scheduleSocialUpdate();
      }
    });

    // Subscribe to kind 1111 (NIP-22 comments) with k=video tag
    const commentsSub = ndk.subscribe({
      kinds: [1111 as number],
      authors,
      '#k': ['video'],
    }, { closeOnEose: false });

    commentsSub.on('event', (event) => {
      if (!event.id || seenEventIds.has(event.id)) return;
      seenEventIds.add(event.id);

      // Find 'i' tag with video identifier
      const iTag = event.tags.find(t => t[0] === 'i')?.[1];
      if (!iTag) return;

      const video = parseVideoFromIdentifier(iTag, event.pubkey, event.created_at || 0);
      if (!video) return;

      const existing = videosByKey.get(video.key);
      // Keep the most recent interaction timestamp
      if (!existing || (video.timestamp && video.timestamp > (existing.timestamp || 0))) {
        videosByKey.set(video.key, video);
        scheduleSocialUpdate();
      }
    });

    untrack(() => {
      socialSubUnsub = () => {
        likesSub.stop();
        commentsSub.stop();
      };
    });

    return () => {
      likesSub.stop();
      commentsSub.stop();
    };
  });

  let feedPage = $state(0);
  let loadingMore = $state(false);
  const FEED_PAGE_SIZE = 12;

  // Combine all discovered videos for the feed (unique)
  let feedVideos = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const result: VideoItem[] = [];

    // Add followed users' videos first
    for (const video of followedUsersVideos) {
      const key = `${video.ownerNpub}/${video.treeName}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(video);
      }
    }

    // Add videos liked/commented by followed users
    for (const video of socialVideos) {
      const key = `${video.ownerNpub}/${video.treeName}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(video);
      }
    }

    // Sort by timestamp
    result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return result.slice(0, (feedPage + 1) * FEED_PAGE_SIZE);
  });

  function loadMoreFeed() {
    if (loadingMore) return;
    loadingMore = true;
    feedPage++;
    setTimeout(() => loadingMore = false, 500);
  }

  // Infinite scroll observer
  let feedEndRef: HTMLDivElement;

  // Total available videos from all sources (for infinite scroll check)
  let totalAvailableVideos = $derived(followedUsersVideos.length + socialVideos.length);

  // Control empty state visibility with delay
  $effect(() => {
    const hasContent = recentVideos.length > 0 || feedVideos.length > 0 || followedUsersVideos.length > 0;
    const isLoading = followsLoading;

    if (hasContent || isLoading) {
      // Clear timer and hide empty state immediately when content appears or loading
      if (emptyStateTimer) {
        clearTimeout(emptyStateTimer);
        emptyStateTimer = null;
      }
      showEmptyState = false;
    } else {
      // Start timer to show empty state after delay
      if (!emptyStateTimer && !showEmptyState) {
        emptyStateTimer = setTimeout(() => {
          showEmptyState = true;
          emptyStateTimer = null;
        }, 2000);
      }
    }
  });

  onMount(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && totalAvailableVideos > feedVideos.length) {
          loadMoreFeed();
        }
      },
      { threshold: 0.1 }
    );

    if (feedEndRef) {
      observer.observe(feedEndRef);
    }

    return () => {
      observer.disconnect();
      if (emptyStateTimer) {
        clearTimeout(emptyStateTimer);
      }
    };
  });

  function npubToPubkey(npub: string): string | null {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }
    } catch {}
    return null;
  }

  function pubkeyToNpub(pubkey: string): string | null {
    try {
      return nip19.npubEncode(pubkey);
    } catch {}
    return null;
  }

  function buildRecentHref(item: RecentItem): string {
    // Encode treeName in path: /npub/treeName -> /npub/encodedTreeName
    // Normalize Unicode to avoid duplicates from different representations (e.g., ä vs a+combining)
    const normalizedTreeName = item.treeName?.normalize('NFC');
    const normalizedVideoId = item.videoId?.normalize('NFC');
    let encodedPath: string;
    if (normalizedTreeName) {
      // For playlist videos, encode treeName and videoId separately
      encodedPath = normalizedVideoId
        ? `/${item.npub}/${encodeURIComponent(normalizedTreeName)}/${encodeURIComponent(normalizedVideoId)}`
        : `/${item.npub}/${encodeURIComponent(normalizedTreeName)}`;
    } else {
      encodedPath = item.path;
    }
    const base = `#${encodedPath}`;
    return item.linkKey ? `${base}?k=${item.linkKey}` : base;
  }

  </script>

<div class="flex-1 overflow-auto">
  <div class="max-w-7xl mx-auto p-4 md:p-6">
    <!-- Recent Videos Section -->
    {#if recentVideos.length > 0}
      <section class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold text-text-1">Recent</h2>
          <button
            class="btn-ghost text-xs"
            onclick={() => clearRecentsByPrefix('videos/')}
          >
            Clear
          </button>
        </div>
        <div class="relative -mx-4">
          <div class="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-thin">
            {#each recentVideos as video (video.href)}
              <div class="shrink-0 w-48 md:w-56">
                <VideoCard
                  href={video.href}
                  title={video.title}
                  duration={video.duration}
                  ownerPubkey={video.ownerPubkey}
                  ownerNpub={video.ownerNpub}
                  treeName={video.treeName}
                  videoId={video.videoId}
                  visibility={video.visibility}
                />
              </div>
            {/each}
          </div>
          <!-- Scroll fade indicator (right side only) -->
          <div class="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface-0 via-surface-0/80 to-transparent"></div>
        </div>
      </section>
    {/if}

    <!-- Feed Section -->
    {#if feedVideos.length > 0}
      <section>
        <h2 class="text-lg font-semibold text-text-1 mb-3">Feed</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {#each feedVideos as video (video.href)}
            {@const playlistInfo = feedPlaylistInfo[video.key]}
            {#if playlistInfo && playlistInfo.videoCount >= 1}
              <PlaylistCard
                href={video.href}
                title={video.title}
                videoCount={playlistInfo.videoCount}
                thumbnailUrl={playlistInfo.thumbnailUrl}
                ownerPubkey={video.ownerPubkey}
                visibility={video.visibility}
              />
            {:else}
              <VideoCard
                href={video.href}
                title={video.title}
                duration={video.duration}
                ownerPubkey={video.ownerPubkey}
                ownerNpub={video.ownerNpub}
                treeName={video.treeName}
                videoId={video.videoId}
                visibility={video.visibility}
              />
            {/if}
          {/each}
        </div>

        <!-- Infinite scroll trigger -->
        <div bind:this={feedEndRef} class="h-10"></div>

        {#if loadingMore}
          <div class="flex justify-center py-4">
            <span class="i-lucide-loader-2 animate-spin text-text-3"></span>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Empty state when no content (delayed to avoid flash) -->
    {#if showEmptyState}
      <div class="text-center py-12 text-text-3">
        <p>No videos found. {#if !isLoggedIn}Sign in to upload videos.{/if}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .scrollbar-thin::-webkit-scrollbar {
    height: 6px;
  }
  .scrollbar-thin::-webkit-scrollbar-track {
    background: transparent;
  }
  .scrollbar-thin::-webkit-scrollbar-thumb {
    background: var(--surface-3);
    border-radius: 3px;
  }
  .scrollbar-thin::-webkit-scrollbar-thumb:hover {
    background: var(--surface-4);
  }
</style>
