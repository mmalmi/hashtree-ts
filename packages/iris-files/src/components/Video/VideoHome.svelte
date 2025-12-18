<script lang="ts">
  /**
   * VideoHome - Home page for video.iris.to
   * YouTube-style home with horizontal sections and infinite feed
   */
  import { onMount, untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../../nostr';
  import { recentsStore, clearRecentsByPrefix, type RecentItem } from '../../stores/recents';
  import { createTreesStore, createFollowsStore } from '../../stores';
  import { openVideoUploadModal } from '../../stores/modals';
  import { getFollows, socialGraphStore, fetchFollowList } from '../../utils/socialGraph';

  // Default pubkey to use for fallback content (sirius)
  const DEFAULT_CONTENT_PUBKEY = '4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0';
  const MIN_FOLLOWS_THRESHOLD = 5;
  import VideoCard from './VideoCard.svelte';
  import type { VideoItem } from './types';

  /** Encode tree name for use in URL path */
  function encodeTreeNameForUrl(treeName: string): string {
    return encodeURIComponent(treeName);
  }

  // Get current user
  let userNpub = $derived($nostrStore.npub);
  let userPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Track loading state for follows
  let followsLoading = $state(true);

  // Get recents and filter to only videos
  let recents = $derived($recentsStore);
  let recentVideos = $derived(
    recents
      .filter(r => r.treeName?.startsWith('videos/'))
      .map(r => ({
        key: r.path,
        title: r.treeName ? r.treeName.slice(7) : r.label,
        ownerPubkey: r.npub ? npubToPubkey(r.npub) : null,
        ownerNpub: r.npub,
        treeName: r.treeName,
        visibility: r.visibility,
        href: buildRecentHref(r),
        timestamp: r.timestamp,
      } as VideoItem))
      .slice(0, 10)
  );

  // Get user's follows
  let follows = $state<string[]>([]);

  // Track social graph version to reactively update fallback follows
  let graphVersion = $derived($socialGraphStore.version);

  // Compute effective follows: user's follows + fallback if < threshold
  let effectiveFollows = $derived.by(() => {
    // Track graph version to re-run when social graph updates
    const _v = graphVersion;

    // If user has enough follows, use them directly
    if (follows.length >= MIN_FOLLOWS_THRESHOLD) {
      return follows;
    }

    // Otherwise, augment with default pubkey + its follows from social graph
    const fallbackFollows = getFollows(DEFAULT_CONTENT_PUBKEY);
    const combined = new Set(follows);
    combined.add(DEFAULT_CONTENT_PUBKEY); // Include the default user itself
    fallbackFollows.forEach(pk => combined.add(pk));

    console.log('[VideoHome] Using fallback follows, user has', follows.length, ', adding', fallbackFollows.size, 'from default');
    return Array.from(combined);
  });

  // Track if we're using fallback content
  let usingFallback = $derived(follows.length < MIN_FOLLOWS_THRESHOLD);

  // Fetch fallback follow list when needed
  let fallbackFetched = false;
  $effect(() => {
    if (usingFallback && !fallbackFetched) {
      fallbackFetched = true;
      console.log('[VideoHome] Fetching fallback follow list for', DEFAULT_CONTENT_PUBKEY);
      fetchFollowList(DEFAULT_CONTENT_PUBKEY);
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
      console.log('[VideoHome] No userPubkey, skipping follows');
      return;
    }

    console.log('[VideoHome] Fetching follows for', pk);
    untrack(() => { followsLoading = true; });
    const store = createFollowsStore(pk);
    const unsub = store.subscribe(value => {
      console.log('[VideoHome] Got follows:', value?.follows?.length || 0);
      untrack(() => {
        follows = value?.follows || [];
        followsLoading = false;
      });
    });
    return unsub;
  });

  // Videos from followed users - aggregate from multiple stores
  let followedUsersVideos = $state<VideoItem[]>([]);
  let followStoreUnsubscribes: Array<() => void> = [];

  $effect(() => {
    // Track effectiveFollows to trigger re-run when it changes (includes fallback)
    const currentFollows = effectiveFollows;
    // Also track graphVersion to re-run when social graph updates
    const _version = graphVersion;
    // Track userPubkey to include own videos
    const myPubkey = userPubkey;

    // Clean up previous subscriptions
    untrack(() => {
      followStoreUnsubscribes.forEach(unsub => unsub());
      followStoreUnsubscribes = [];
    });

    console.log('[VideoHome] follows effect, count:', currentFollows.length, 'usingFallback:', usingFallback);

    // Include self + follows (deduplicated)
    const pubkeysToCheck = new Set(currentFollows);
    if (myPubkey) {
      pubkeysToCheck.add(myPubkey);
    }

    if (pubkeysToCheck.size === 0) {
      untrack(() => { followedUsersVideos = []; });
      return;
    }

    const videosByUser = new Map<string, VideoItem[]>();

    // Subscribe to trees for each user (limit to avoid too many subscriptions)
    const followsToCheck = Array.from(pubkeysToCheck).slice(0, 20);
    console.log('[VideoHome] Checking trees for', followsToCheck.length, 'users (includes self)');

    for (const followPubkey of followsToCheck) {
      const followNpub = pubkeyToNpub(followPubkey);
      if (!followNpub) continue;

      const store = createTreesStore(followNpub);
      const unsub = store.subscribe(trees => {
        const videos = trees
          .filter(t => t.name.startsWith('videos/') && t.visibility === 'public')
          .map(t => ({
            key: `/${followNpub}/${t.name}`,
            title: t.name.slice(7),
            ownerPubkey: followPubkey,
            ownerNpub: followNpub,
            treeName: t.name,
            visibility: t.visibility,
            href: `#/${followNpub}/${encodeTreeNameForUrl(t.name)}`,
            timestamp: t.createdAt || 0,
          } as VideoItem));

        videosByUser.set(followPubkey, videos);

        // Aggregate all videos and sort by timestamp
        const allVideos: VideoItem[] = [];
        videosByUser.forEach(vids => allVideos.push(...vids));
        allVideos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        untrack(() => { followedUsersVideos = allVideos; });
      });

      untrack(() => { followStoreUnsubscribes.push(unsub); });
    }

    return () => {
      followStoreUnsubscribes.forEach(unsub => unsub());
    };
  });

  // Social graph feed - videos from users within follow distance
  let socialGraphVideos = $state<VideoItem[]>([]);
  let feedPage = $state(0);
  let loadingMore = $state(false);
  const FEED_PAGE_SIZE = 12;

  // Combine all discovered videos for the feed (unique)
  let feedVideos = $derived.by(() => {
    const seen = new Set<string>();
    const result: VideoItem[] = [];

    // Add followed users' videos first
    for (const video of followedUsersVideos) {
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

  onMount(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && followedUsersVideos.length > feedVideos.length) {
          loadMoreFeed();
        }
      },
      { threshold: 0.1 }
    );

    if (feedEndRef) {
      observer.observe(feedEndRef);
    }

    return () => observer.disconnect();
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
    const encodedPath = item.treeName
      ? `/${item.npub}/${encodeURIComponent(item.treeName)}`
      : item.path;
    const base = `#${encodedPath}`;
    return item.linkKey ? `${base}?k=${item.linkKey}` : base;
  }

  function uploadVideo() {
    if (!userNpub) {
      alert('Please sign in to upload a video');
      return;
    }
    openVideoUploadModal();
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
            class="btn-ghost text-xs text-text-3 hover:text-text-2"
            onclick={() => clearRecentsByPrefix('videos/')}
          >
            Clear
          </button>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-thin">
          {#each recentVideos as video (video.href)}
            <div class="shrink-0 w-48 md:w-56">
              <VideoCard
                href={video.href}
                title={video.title}
                duration={video.duration}
                ownerPubkey={video.ownerPubkey}
                ownerNpub={video.ownerNpub}
                treeName={video.treeName}
                visibility={video.visibility}
              />
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Feed Section -->
    {#if feedVideos.length > 0}
      <section>
        <h2 class="text-lg font-semibold text-text-1 mb-3">Feed</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {#each feedVideos as video (video.href)}
            <VideoCard
              href={video.href}
              title={video.title}
              duration={video.duration}
              ownerPubkey={video.ownerPubkey}
              ownerNpub={video.ownerNpub}
              treeName={video.treeName}
              visibility={video.visibility}
            />
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

    <!-- Empty state when no content -->
    {#if recentVideos.length === 0 && feedVideos.length === 0 && followedUsersVideos.length === 0 && !followsLoading}
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
