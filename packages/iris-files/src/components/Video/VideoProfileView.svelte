<script lang="ts">
  /**
   * VideoProfileView - User's video channel page
   * Shows user info and their videos
   */
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../../nostr';
  import { createTreesStore, createProfileStore } from '../../stores';
  import { openVideoUploadModal } from '../../stores/modals';
  import { followPubkey, unfollowPubkey, getFollowsSync, createFollowsStore } from '../../stores/follows';
  import { openShareModal } from '../../stores/modals';
  import { Avatar, Name } from '../User';
  import VideoCard from './VideoCard.svelte';
  import type { VideoItem } from './types';
  import { getFollowers, socialGraphStore } from '../../utils/socialGraph';

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
  let trees = $state<Array<{ name: string; visibility?: string; rootHash?: string; linkKey?: string }>>([]);

  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  // Filter to videos only
  let videos = $derived(
    trees
      .filter(t => t.name.startsWith('videos/'))
      .map(t => ({
        key: `/${npub}/${t.name}`,
        title: t.name.slice(7),
        ownerPubkey: ownerPubkey,
        ownerNpub: npub,
        treeName: t.name,
        visibility: t.visibility,
        href: `#/${npub}/${t.name}${t.linkKey ? `?k=${t.linkKey}` : ''}`,
      } as VideoItem))
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
    openVideoUploadModal();
  }

  function handleShare() {
    openShareModal(window.location.href);
  }
</script>

<div class="flex-1 overflow-auto">
  <!-- Banner -->
  <div class="h-32 md:h-48 bg-surface-2">
    {#if profile?.banner}
      <img src={profile.banner} alt="" class="w-full h-full object-cover" />
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
          <span>{videos.length} video{videos.length !== 1 ? 's' : ''}</span>
          <a href={`#/${npub}/follows`} class="hover:text-text-1">
            <span class="font-bold text-text-2">{profileFollows.length}</span> Following
          </a>
          <a href={`#/${npub}/followers`} class="hover:text-text-1">
            <span class="font-bold text-text-2">{knownFollowers.size}</span> Known Followers
          </a>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button onclick={handleShare} class="btn-ghost p-2" title="Share">
          <span class="i-lucide-share text-lg"></span>
        </button>
        {#if isOwnProfile}
          <a href={`#/${npub}/edit`} class="btn-ghost px-4 py-2">
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

    <!-- Videos grid -->
    <div class="pb-8">
      {#if videos.length === 0}
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
      {:else}
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
