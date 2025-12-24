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
  import Dropdown from './components/ui/Dropdown.svelte';
  import { currentPath, initRouter } from './lib/router.svelte';
  import { nostrStore } from './nostr';

  const isDev = import.meta.env.DEV;
  let RenderScan: typeof import('svelte-render-scan').RenderScan | null = $state(null);
  if (isDev) {
    import('svelte-render-scan').then(m => RenderScan = m.RenderScan);
  }

  // Modal components
  import ShareModal from './components/Modals/ShareModal.svelte';
  import ForkModal from './components/Modals/ForkModal.svelte';
  import BlossomPushModal from './components/Modals/BlossomPushModal.svelte';
  import AddToPlaylistModal from './components/Modals/AddToPlaylistModal.svelte';
  import VideoUploadModal, { open as openVideoUploadModal } from './components/Video/VideoUploadModal.svelte';
  import ImportModal, { open as openImportModal } from './components/Video/ImportModal.svelte';

  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let createDropdownOpen = $state(false);

  // Initialize router on mount
  onMount(() => {
    initRouter();
  });

  function handleUploadVideo() {
    createDropdownOpen = false;
    openVideoUploadModal();
  }

  function handleLivestream() {
    createDropdownOpen = false;
    window.location.hash = '#/create';
  }

  function handleImport() {
    createDropdownOpen = false;
    openImportModal();
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
        <Dropdown bind:open={createDropdownOpen} onClose={() => createDropdownOpen = false} align="right">
          {#snippet trigger()}
            <button
              onclick={() => createDropdownOpen = !createDropdownOpen}
              class="btn-ghost p-2 flex items-center gap-1 rounded-full"
              title="Create"
            >
              <span class="i-lucide-plus text-lg"></span>
              <span class="hidden sm:inline text-sm">Create</span>
            </button>
          {/snippet}
          <div class="bg-surface-1 py-1">
            <button onclick={handleUploadVideo} class="w-full px-4 py-2 text-left btn-ghost flex items-center gap-3">
              <span class="i-lucide-upload text-lg"></span>
              <span>Upload Video</span>
            </button>
            <button onclick={handleLivestream} class="w-full px-4 py-2 text-left btn-ghost flex items-center gap-3">
              <span class="i-lucide-radio text-lg"></span>
              <span>Livestream</span>
            </button>
            <button onclick={handleImport} class="w-full px-4 py-2 text-left btn-ghost flex items-center gap-3">
              <span class="i-lucide-folder-input text-lg"></span>
              <span>Import</span>
            </button>
          </div>
        </Dropdown>
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
  <ShareModal />
  <ForkModal />
  <BlossomPushModal />
  <AddToPlaylistModal />
  <VideoUploadModal />
  <ImportModal />
  <Toast />
  {#if RenderScan}
    <RenderScan initialEnabled={false} />
  {/if}
</div>
