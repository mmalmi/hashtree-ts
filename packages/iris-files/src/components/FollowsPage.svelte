<script lang="ts">
  /**
   * FollowsPage - list of followed users
   */
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../nostr';
  import { createFollowsStore, followPubkey, unfollowPubkey } from '../stores/follows';
  import { getFollowsMe, socialGraphStore } from '../utils/socialGraph';
  import { Avatar, Name, Badge, FollowedBy } from './User';
  import { BackButton } from './ui';

  interface Props {
    npub?: string;
  }

  let { npub }: Props = $props();

  // Current user state
  let myPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Decode npub to hex pubkey
  let pubkeyHex = $derived.by(() => {
    if (!npub) return '';
    try {
      const decoded = nip19.decode(npub);
      return decoded.data as string;
    } catch {
      return '';
    }
  });

  let isOwnProfile = $derived(myPubkey === pubkeyHex);

  // Follows store for the viewed profile
  let profileFollowsStore = $derived(pubkeyHex ? createFollowsStore(pubkeyHex) : null);
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

  // My follows store (for follow/unfollow buttons)
  let myFollowsStore = $derived(myPubkey ? createFollowsStore(myPubkey) : null);
  let myFollows = $state<string[]>([]);

  $effect(() => {
    if (!myFollowsStore) {
      myFollows = [];
      return;
    }
    const unsub = myFollowsStore.subscribe(value => {
      myFollows = value?.follows || [];
    });
    return () => {
      unsub();
      myFollowsStore?.destroy();
    };
  });

  // Check if a user follows me
  function followsMe(userPubkey: string): boolean {
    $socialGraphStore.version;
    return getFollowsMe(userPubkey);
  }

  // Track loading state per pubkey for follow/unfollow
  let loadingPubkeys = $state<Set<string>>(new Set());

  async function handleFollowToggle(targetPubkey: string) {
    if (!isLoggedIn || targetPubkey === myPubkey) return;

    loadingPubkeys = new Set([...loadingPubkeys, targetPubkey]);

    const isCurrentlyFollowing = myFollows.includes(targetPubkey);
    if (isCurrentlyFollowing) {
      await unfollowPubkey(targetPubkey);
    } else {
      await followPubkey(targetPubkey);
    }

    loadingPubkeys = new Set([...loadingPubkeys].filter(p => p !== targetPubkey));
  }

  function isFollowingUser(pubkey: string): boolean {
    return myFollows.includes(pubkey);
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0 overflow-y-auto">
  <!-- Header -->
  <div class="shrink-0 px-4 py-3 border-b border-surface-3 bg-surface-1">
    <div class="flex items-center gap-3 max-w-2xl mx-auto">
      <BackButton href={npub ? `/${npub}/profile` : '/'} />
      {#if pubkeyHex}
        <a href={`#/${npub}/profile`} class="shrink-0">
          <Avatar pubkey={pubkeyHex} size={32} />
        </a>
        <div class="min-w-0 flex-1">
          <a href={`#/${npub}/profile`} class="font-medium text-text-1 hover:underline truncate block">
            <Name pubkey={pubkeyHex} />
          </a>
        </div>
        <span class="text-text-3 text-sm">Following ({profileFollows.length})</span>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-2xl mx-auto">
      {#if profileFollows.length === 0}
        <div class="p-6 text-center text-muted">
          Not following anyone yet
        </div>
      {:else}
        <div class="divide-y divide-surface-2">
          {#each profileFollows as followedPubkey (followedPubkey)}
            {@const isLoading = loadingPubkeys.has(followedPubkey)}
            {@const amFollowing = isFollowingUser(followedPubkey)}
            {@const isSelf = followedPubkey === myPubkey}
            {@const theyFollowMe = followsMe(followedPubkey)}
            <div class="flex items-center gap-3 p-4 hover:bg-surface-1 transition-colors">
              <!-- Avatar -->
              <a
                href="#/{nip19.npubEncode(followedPubkey)}"
                class="shrink-0"
              >
                <Avatar pubkey={followedPubkey} size={44} showBadge={true} />
              </a>

              <!-- Name and info -->
              <div class="flex-1 min-w-0">
                <a
                  href="#/{nip19.npubEncode(followedPubkey)}"
                  class="font-medium text-text-1 hover:underline truncate block"
                >
                  <Name pubkey={followedPubkey} />
                </a>
                <div class="text-xs text-text-3">
                  {#if theyFollowMe}
                    <span class="text-accent">Follows you</span>
                  {:else if !isOwnProfile && followedPubkey !== pubkeyHex}
                    <FollowedBy pubkey={followedPubkey} />
                  {/if}
                </div>
              </div>

              <!-- Follow/Unfollow button -->
              {#if isLoggedIn && !isSelf}
                <button
                  onclick={() => handleFollowToggle(followedPubkey)}
                  disabled={isLoading}
                  class="shrink-0 {amFollowing ? 'btn-ghost' : 'btn-success'} text-sm"
                >
                  {isLoading ? '...' : amFollowing ? 'Unfollow' : 'Follow'}
                </button>
              {:else if isSelf}
                <span class="text-xs text-accent flex items-center gap-1 shrink-0">
                  <Badge pubKeyHex={followedPubkey} size="sm" /> You
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
