<script lang="ts">
  /**
   * VideoApp - Video-focused app shell for video.iris.to
   * YouTube-style UI for video sharing and streaming
   */
  import { onMount } from 'svelte';
  import NostrLogin from './components/NostrLogin.svelte';
  import ConnectivityIndicator from './components/ConnectivityIndicator.svelte';
  import SearchInput from './components/SearchInput.svelte';
  import MobileSearch from './components/MobileSearch.svelte';
  import Toast from './components/Toast.svelte';
  import VideoRouter from './components/Video/VideoRouter.svelte';
  import { currentPath, initRouter } from './lib/router.svelte';
  import { nostrStore } from './nostr';
  import { openVideoUploadModal } from './stores/modals';

  // Modal components
  import ShareModal from './components/Modals/ShareModal.svelte';
  import ForkModal from './components/Modals/ForkModal.svelte';
  import BlossomPushModal from './components/Modals/BlossomPushModal.svelte';
  import VideoUploadModal from './components/Video/VideoUploadModal.svelte';
  import AddToPlaylistModal from './components/Modals/AddToPlaylistModal.svelte';

  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Initialize router on mount
  onMount(() => {
    initRouter();
  });

  function handleCreate() {
    openVideoUploadModal();
  }
</script>

<div class="h-full flex flex-col bg-surface-0">
  <!-- Top bar -->
  <header class="h-12 shrink-0 bg-surface-1 border-b border-surface-3 flex items-center justify-between px-3 md:px-4 gap-2 relative">
    <a href="#/" class="flex items-center gap-2 no-underline select-none shrink-0">
      <img src="/iris-logo.png" alt="Iris" class="w-8 h-8" draggable="false" />
      <span class="font-semibold text-text-1"><span class="text-accent">Iris</span> Video</span>
    </a>

    <div class="flex items-center gap-2 md:gap-3">
      <MobileSearch />
      <div class="hidden md:block"><SearchInput /></div>
      {#if isLoggedIn}
        <button
          onclick={handleCreate}
          class="btn-ghost p-2 flex items-center gap-1 rounded-full"
          title="Create"
        >
          <span class="i-lucide-plus text-lg"></span>
          <span class="hidden sm:inline text-sm">Create</span>
        </button>
      {/if}
      <ConnectivityIndicator />
      <NostrLogin />
    </div>
  </header>

  <!-- Main area -->
  <div class="flex-1 flex flex-col min-h-0">
    <VideoRouter currentPath={$currentPath} />
  </div>

  <!-- Modals -->
  <VideoUploadModal />
  <ShareModal />
  <ForkModal />
  <BlossomPushModal />
  <AddToPlaylistModal />
  <Toast />
</div>
