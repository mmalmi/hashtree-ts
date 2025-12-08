<script lang="ts">
  /**
   * ProfileView - displays user profile
   * Port of React ProfileView component
   */
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../nostr';
  import { createProfileStore } from '../hooks/useProfile';
  import { openShareModal } from '../hooks/useModals';
  import { Avatar, Name } from './User';
  import CopyText from './CopyText.svelte';

  interface Props {
    npub: string;
  }

  let { npub }: Props = $props();

  let myPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Decode npub to hex pubkey
  let pubkeyHex = $derived.by(() => {
    try {
      const decoded = nip19.decode(npub);
      return decoded.data as string;
    } catch {
      return '';
    }
  });

  let isOwnProfile = $derived(myPubkey === pubkeyHex);

  // Profile store
  let profileStore = $derived(createProfileStore(npub));
  let profile = $state<{ name?: string; display_name?: string; about?: string; banner?: string; picture?: string; nip05?: string; website?: string } | null>(null);

  $effect(() => {
    const store = profileStore;
    const unsub = store.subscribe(value => {
      profile = value;
    });
    return unsub;
  });

  let bannerError = $state(false);

  function navigate(path: string) {
    window.location.hash = path;
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0 overflow-y-auto">
  <!-- Banner -->
  <div class="h-32 md:h-40 bg-surface-2 relative shrink-0">
    {#if profile?.banner && !bannerError}
      <img
        src={profile.banner}
        alt=""
        class="w-full h-full object-cover"
        onerror={() => bannerError = true}
      />
    {/if}
  </div>

  <!-- Profile header -->
  <div class="px-4 pb-4 -mt-12 relative">
    <!-- Avatar -->
    <div class="mb-3">
      <Avatar pubkey={pubkeyHex} size={80} class="border-4 border-surface-0" />
    </div>

    <!-- Name and action buttons -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <h1 class="text-xl font-bold text-text-1 m-0 truncate">
          <Name pubkey={pubkeyHex} />
        </h1>
        {#if isOwnProfile}
          <span class="shrink-0 text-xs text-blue-500 flex items-center gap-1">
            You
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        {#if isLoggedIn && isOwnProfile}
          <button
            onclick={() => navigate('/users')}
            class="btn-ghost"
            title="Switch user"
          >
            Users
          </button>
          <button
            onclick={() => navigate(`/${npub}/edit`)}
            class="btn-ghost"
          >
            Edit Profile
          </button>
        {/if}
        <button
          onclick={() => openShareModal(window.location.href)}
          class="btn-ghost"
          title="Share"
        >
          <span class="i-lucide-share text-base"></span>
        </button>
      </div>
    </div>

    <!-- npub with copy -->
    <CopyText
      text={npub}
      displayText={npub.slice(0, 8) + '...' + npub.slice(-4)}
      class="text-sm mt-1"
      testId="copy-npub"
    />

    {#if profile?.nip05}
      <div class="text-sm text-accent mt-1">{profile.nip05}</div>
    {/if}

    <!-- About -->
    {#if profile?.about}
      <p class="text-sm text-text-2 mt-3 whitespace-pre-wrap break-words">
        {profile.about}
      </p>
    {/if}

    <!-- Website -->
    {#if profile?.website}
      <a
        href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-accent mt-3 inline-block hover:underline"
      >
        {profile.website}
      </a>
    {/if}
  </div>
</div>
