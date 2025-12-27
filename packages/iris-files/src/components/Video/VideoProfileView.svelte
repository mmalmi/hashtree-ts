<script lang="ts">
  /**
   * VideoProfileView - User's video channel page
   * Shows user info and their videos (including playlists)
   */
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../../nostr';
  import { createTreesStore, createProfileStore } from '../../stores';
  import { followPubkey, unfollowPubkey, getFollowsSync, createFollowsStore } from '../../stores/follows';
  import { open as openShareModal } from '../Modals/ShareModal.svelte';
  import { Avatar, Name } from '../User';
  import VideoCard from './VideoCard.svelte';
  import PlaylistCard from './PlaylistCard.svelte';
  import ProxyImg from '../ProxyImg.svelte';
  import type { VideoItem } from './types';
  import { getFollowers, socialGraphStore } from '../../utils/socialGraph';
  import { UserZaps } from '../Zaps';
  import { getTree } from '../../store';
  import { getLocalRootCache, getLocalRootKey } from '../../treeRootCache';
  import { hasVideoFile, findThumbnailEntry, MIN_VIDEOS_FOR_STRUCTURE } from '../../utils/playlistDetection';
    import type { CID } from 'hashtree';

  interface PlaylistInfo {
    key: string;
    title: string;
    treeName: string;
    ownerNpub: string | undefined;
    ownerPubkey: string | null;
    visibility: string | undefined;
    href: string;
    videoCount: number;
    thumbnailUrl?: string;
    isPlaylist: true;
  }

  /** Encode tree name for use in URL path */
  function encodeTreeNameForUrl(treeName: string): string {
    return encodeURIComponent(treeName);
  }

  interface Props {
    npub?: string;
  }

  let { npub }: Props = $props();

  // Current user
  let currentUserNpub = $derived($nostrStore.npub);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let isOwnProfile = $derived(npub === currentUserNpub);

  // Profile owner pubkey
  let ownerPubkey = $derived.by(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {}
    return null;
  });

  // Profile data
  let profileStore = $derived(createProfileStore(npub || ''));
  let profile = $state<{ name?: string; about?: string; picture?: string; banner?: string } | null>(null);

  $effect(() => {
    const store = profileStore;
    const unsub = store.subscribe(value => {
      profile = value;
    });
    return unsub;
  });

  // User's trees
  let treesStore = $derived(createTreesStore(npub));
  let trees = $state<Array<{ name: string; visibility?: string; hashHex?: string; linkKey?: string }>>([]);

  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  // Filter to videos only (initial list before playlist detection)
  let videoTrees = $derived(trees.filter(t => t.name.startsWith('videos/')));

  // Track which trees are playlists (detected asynchronously)
  // Using plain object for better Svelte 5 reactivity (Maps don't track well)
  let playlistInfo = $state<Record<string, { videoCount: number; thumbnailUrl?: string }>>({});

  // Detect playlists when trees change
  let detectingPlaylists = false;
  let lastDetectedTrees = '';
  $effect(() => {
    if (!npub) return;
    const currentVideoTrees = videoTrees;
    if (currentVideoTrees.length === 0) return;
    // Prevent re-running if already detecting or trees haven't changed
    const treesKey = currentVideoTrees.map(t => t.name + ':' + (t.hashHex || '')).join(',');
    if (detectingPlaylists || treesKey === lastDetectedTrees) return;
    lastDetectedTrees = treesKey;
    detectingPlaylists = true;
    detectPlaylists(currentVideoTrees).finally(() => { detectingPlaylists = false; });
  });

  async function detectPlaylists(treesToCheck: typeof videoTrees) {
    const tree = getTree();
    const newPlaylistInfo: Record<string, { videoCount: number; thumbnailUrl?: string }> = {};

    // Process trees concurrently with limited parallelism
    const CONCURRENCY = 4;
    let idx = 0;
    let inFlight = 0;
    let pending: Promise<void>[] = [];

    const processTree = async (t: typeof treesToCheck[0]): Promise<void> => {
      try {
        // Get root CID - use hash and encryptionKey from tree entry, or fall back to local cache
        let rootCid: CID | null = null;

        if (t.hash) {
          // Use the encryption key from the tree entry (already a Uint8Array)
          rootCid = { hash: t.hash, key: t.encryptionKey };
        } else {
          // Fallback to local cache
          const localHash = getLocalRootCache(npub!, t.name);
          if (localHash) {
            const localKey = getLocalRootKey(npub!, t.name);
            rootCid = { hash: localHash, key: localKey };
          }
        }

        if (!rootCid) return;

        // Detect from tree
        const entries = await tree.listDirectory(rootCid);
        if (!entries || entries.length === 0) return;

        // Check subdirectories in parallel (with limit)
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
                  firstThumbnailUrl = `/htree/${npub}/${encodeURIComponent(t.name)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(thumbEntry.name)}`;
                }
              }
            }
          } catch {
            // Not a directory
          }
        };

        // Run entry checks in parallel
        await Promise.all(entries.map(checkEntry));

        if (videoCount >= MIN_VIDEOS_FOR_STRUCTURE) {
          newPlaylistInfo[t.name] = { videoCount, thumbnailUrl: firstThumbnailUrl };
        }
      } catch {
        // Ignore errors
      }
    };

    // Process with limited concurrency
    while (idx < treesToCheck.length) {
      while (inFlight < CONCURRENCY && idx < treesToCheck.length) {
        const t = treesToCheck[idx++];
        inFlight++;
        pending.push(processTree(t).finally(() => { inFlight--; }));
      }
      // Wait for at least one to complete before continuing
      if (pending.length >= CONCURRENCY) {
        await Promise.race(pending);
        pending = pending.filter(p => p !== undefined); // Clean up settled
      }
    }
    // Wait for remaining
    await Promise.all(pending);

    playlistInfo = newPlaylistInfo;
  }

  // Get playlist tree names as a Set for efficient lookup
  // Using Object.keys() ensures Svelte tracks the object
  let playlistTreeNames = $derived(new Set(Object.keys(playlistInfo)));

  // Combined list of videos and playlists
  let videos = $derived(
    videoTrees
      .filter(t => !playlistTreeNames.has(t.name)) // Exclude playlists
      .map(t => ({
        key: `/${npub}/${t.name}`,
        title: t.name.slice(7),
        ownerPubkey: ownerPubkey,
        ownerNpub: npub,
        treeName: t.name,
        visibility: t.visibility,
        href: `#/${npub}/${encodeTreeNameForUrl(t.name)}${t.linkKey ? `?k=${t.linkKey}` : ''}`,
        isPlaylist: false,
      } as VideoItem))
  );

  let playlists = $derived(
    videoTrees
      .filter(t => playlistTreeNames.has(t.name))
      .map(t => {
        const info = playlistInfo[t.name];
        return {
          key: `/${npub}/${t.name}`,
          title: t.name.slice(7),
          ownerPubkey: ownerPubkey,
          ownerNpub: npub,
          treeName: t.name,
          visibility: t.visibility,
          href: `#/${npub}/${encodeTreeNameForUrl(t.name)}`,
          videoCount: info?.videoCount || 0,
          thumbnailUrl: info?.thumbnailUrl,
          isPlaylist: true,
        } as PlaylistInfo;
      })
  );

  // Following state
  let following = $state(false);
  let currentUserPubkey = $derived($nostrStore.pubkey);

  $effect(() => {
    if (ownerPubkey && !isOwnProfile && currentUserPubkey) {
      const myFollows = getFollowsSync(currentUserPubkey);
      following = myFollows?.follows?.includes(ownerPubkey) || false;
    }
  });

  // Follows store for the profile's following count
  let profileFollowsStore = $derived(ownerPubkey ? createFollowsStore(ownerPubkey) : null);
  let profileFollows = $state<string[]>([]);

  $effect(() => {
    if (!profileFollowsStore) {
      profileFollows = [];
      return;
    }
    const unsub = profileFollowsStore.subscribe(value => {
      profileFollows = value?.follows || [];
    });
    return () => {
      unsub();
      profileFollowsStore?.destroy();
    };
  });

  // Social graph for known followers
  let graphVersion = $derived($socialGraphStore.version);
  let knownFollowers = $derived.by(() => {
    graphVersion; // Subscribe to changes
    return ownerPubkey ? getFollowers(ownerPubkey) : new Set();
  });

  function handleFollow() {
    if (!ownerPubkey) return;
    if (following) {
      unfollowPubkey(ownerPubkey);
      following = false;
    } else {
      followPubkey(ownerPubkey);
      following = true;
    }
  }

  function uploadVideo() {
    window.location.hash = '#/create';
  }

  function handleShare() {
    openShareModal(window.location.href);
  }
</script>

<div class="flex-1 overflow-auto">
  <!-- Banner -->
  <div class="h-32 md:h-48 bg-surface-2">
    {#if profile?.banner}
      <ProxyImg
        src={profile.banner}
        alt=""
        width={1200}
        height={384}
        class="w-full h-full object-cover"
      />
    {/if}
  </div>

  <div class="max-w-6xl mx-auto px-4">
    <!-- Profile header -->
    <div class="flex flex-col md:flex-row items-start md:items-center gap-4 pt-4 mb-6">
      <div class="shrink-0 -mt-16 z-10 bg-surface-0 rounded-full p-1">
        {#if ownerPubkey}
          <Avatar pubkey={ownerPubkey} size={96} />
        {/if}
      </div>

      <div class="flex-1 min-w-0">
        <h1 class="text-xl font-bold text-text-1">
          {#if ownerPubkey}
            <Name pubkey={ownerPubkey} />
          {:else}
            Unknown
          {/if}
        </h1>
        {#if profile?.about}
          <p class="text-text-3 text-sm mt-1 line-clamp-2">{profile.about}</p>
        {/if}
        <div class="flex items-center gap-4 mt-1 text-sm text-text-3">
          <span><span class="font-bold text-text-2">{videos.length + playlists.length}</span> video{videos.length + playlists.length !== 1 ? 's' : ''}{playlists.length > 0 ? ` (${playlists.length} playlist${playlists.length !== 1 ? 's' : ''})` : ''}</span>
          <a href={`#/${npub}/follows`} class="text-text-3 hover:text-text-1 no-underline">
            <span class="font-bold text-text-2">{profileFollows.length}</span> Following
          </a>
          <a href={`#/${npub}/followers`} class="text-text-3 hover:text-text-1 no-underline">
            <span class="font-bold text-text-2">{knownFollowers.size}</span> Known Followers
          </a>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button onclick={handleShare} class="btn-ghost p-2" title="Share">
          <span class="i-lucide-share text-lg"></span>
        </button>
        {#if isOwnProfile}
          <a href="#/users" class="btn-ghost px-4 py-2 no-underline" title="Switch user">
            Switch User
          </a>
          <a href={`#/${npub}/edit`} class="btn-ghost px-4 py-2 no-underline">
            Edit Profile
          </a>
          <button onclick={uploadVideo} class="btn-primary px-4 py-2">
            Upload Video
          </button>
        {:else if isLoggedIn && ownerPubkey}
          <button onclick={handleFollow} class={following ? 'btn-ghost px-4 py-2' : 'btn-primary px-4 py-2'}>
            {following ? 'Following' : 'Follow'}
          </button>
        {/if}
      </div>
    </div>

    <!-- Zaps received -->
    {#if ownerPubkey}
      <div class="mb-6">
        <UserZaps pubkey={ownerPubkey} collapsible={true} maxItems={20} />
      </div>
    {/if}

    <!-- Playlists section -->
    {#if playlists.length > 0}
      <div class="mb-8">
        <h2 class="text-lg font-semibold text-text-1 mb-4">Playlists</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {#each playlists as playlist (playlist.href)}
            <PlaylistCard
              href={playlist.href}
              title={playlist.title}
              videoCount={playlist.videoCount}
              thumbnailUrl={playlist.thumbnailUrl}
              ownerPubkey={playlist.ownerPubkey}
              visibility={playlist.visibility}
            />
          {/each}
        </div>
      </div>
    {/if}

    <!-- Videos grid -->
    <div class="pb-8">
      {#if videos.length === 0 && playlists.length === 0}
        <div class="text-center py-12 text-text-3">
          {#if isOwnProfile}
            <p>You haven't uploaded any videos yet.</p>
            <button onclick={uploadVideo} class="btn-primary mt-4 px-6 py-2">
              Upload Your First Video
            </button>
          {:else}
            <p>No videos yet.</p>
          {/if}
        </div>
      {:else if videos.length > 0}
        {#if playlists.length > 0}
          <h2 class="text-lg font-semibold text-text-1 mb-4">Videos</h2>
        {/if}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {#each videos as video (video.href)}
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
      {/if}
    </div>
  </div>
</div>
