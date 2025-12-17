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
  import { getFollowDistance } from '../../utils/socialGraph';
  import VideoCard from './VideoCard.svelte';
  import type { VideoItem } from './types';

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
    // Track follows to trigger re-run when it changes
    const currentFollows = follows;

    // Clean up previous subscriptions
    untrack(() => {
      followStoreUnsubscribes.forEach(unsub => unsub());
      followStoreUnsubscribes = [];
    });

    console.log('[VideoHome] follows effect, count:', currentFollows.length);

    if (currentFollows.length === 0) {
      untrack(() => { followedUsersVideos = []; });
      return;
    }

    const videosByUser = new Map<string, VideoItem[]>();

    // Subscribe to trees for each followed user (limit to avoid too many subscriptions)
    const followsToCheck = currentFollows.slice(0, 20);
    console.log('[VideoHome] Checking trees for', followsToCheck.length, 'follows');

    for (const followPubkey of followsToCheck) {
      const followNpub = pubkeyToNpub(followPubkey);
      if (!followNpub) continue;

      const store = createTreesStore(followNpub);
      const unsub = store.subscribe(trees => {
        console.log('[VideoHome] Got trees for', followNpub.slice(0, 15), ':', trees.length, 'trees');
        const videos = trees
          .filter(t => t.name.startsWith('videos/') && t.visibility === 'public')
          .map(t => ({
            key: `/${followNpub}/${t.name}`,
            title: t.name.slice(7),
            ownerPubkey: followPubkey,
            ownerNpub: followNpub,
            treeName: t.name,
            visibility: t.visibility,
            href: `#/${followNpub}/${t.name}`,
            timestamp: t.createdAt || 0,
          } as VideoItem));

        console.log('[VideoHome] Found', videos.length, 'videos for', followNpub.slice(0, 15));
        videosByUser.set(followPubkey, videos);

        // Aggregate all videos and sort by timestamp
        const allVideos: VideoItem[] = [];
        videosByUser.forEach(vids => allVideos.push(...vids));
        allVideos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        untrack(() => { followedUsersVideos = allVideos; });
        console.log('[VideoHome] Total followedUsersVideos:', allVideos.length);
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
    const base = `#${item.path}`;
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

    <!-- From Followed Users Section -->
    {#if isLoggedIn && (followedUsersVideos.length > 0 || followsLoading)}
      <section class="mb-8">
        <h2 class="text-lg font-semibold text-text-1 mb-3">From People You Follow</h2>
        {#if followsLoading && followedUsersVideos.length === 0}
          <div class="flex items-center gap-2 text-text-3 py-4">
            <span class="i-lucide-loader-2 animate-spin"></span>
            <span>Loading...</span>
          </div>
        {:else}
          <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-thin">
            {#each followedUsersVideos.slice(0, 10) as video (video.href)}
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
        {/if}
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

    <!-- Empty state for logged out users -->
    {#if !isLoggedIn && recentVideos.length === 0 && feedVideos.length === 0}
      <div class="text-center py-12 text-text-3">
        <p>Sign in to upload videos and see content from people you follow</p>
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
