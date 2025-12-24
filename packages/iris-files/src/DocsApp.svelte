<script lang="ts">
  /**
   * DocsApp - Simplified document-focused app shell for docs.iris.to
   * Google Docs-style UI focused on collaborative documents
   */
  import { onMount } from 'svelte';
  import NostrLogin from './components/NostrLogin.svelte';
  import ConnectivityIndicator from './components/ConnectivityIndicator.svelte';
  import SearchInput from './components/SearchInput.svelte';
  import MobileSearch from './components/MobileSearch.svelte';
  import Toast from './components/Toast.svelte';
  import DocsRouter from './components/Docs/DocsRouter.svelte';
  import { currentPath, initRouter } from './lib/router.svelte';

  const isDev = import.meta.env.DEV;
  let RenderScan: typeof import('svelte-render-scan').RenderScan | null = $state(null);
  if (isDev) {
    import('svelte-render-scan').then(m => RenderScan = m.RenderScan);
  }

  // Modal components
  import ShareModal from './components/Modals/ShareModal.svelte';
  import CollaboratorsModal from './components/Modals/CollaboratorsModal.svelte';
  import ForkModal from './components/Modals/ForkModal.svelte';
  import BlossomPushModal from './components/Modals/BlossomPushModal.svelte';
  import CreateModal from './components/Modals/CreateModal.svelte';

  // Initialize router on mount
  onMount(() => {
    initRouter();
  });
</script>

<div class="h-full flex flex-col bg-surface-0">
  <!-- Top bar -->
  <header class="h-12 shrink-0 bg-surface-1 border-b border-surface-3 flex items-center justify-between px-3 md:px-4 gap-2 relative">
    <a href="#/" class="flex items-center gap-2 no-underline select-none">
      <img src="/iris-logo.png" alt="Iris" class="w-8 h-8" draggable="false" />
      <span class="font-semibold text-text-1 hidden sm:inline"><span class="text-accent">Iris</span> Docs</span>
    </a>

    <div class="flex items-center gap-2 md:gap-3">
      <MobileSearch />
      <div class="hidden md:block"><SearchInput /></div>
      <ConnectivityIndicator />
      <NostrLogin />
    </div>
  </header>

  <!-- Main area -->
  <div class="flex-1 flex flex-col min-h-0">
    <DocsRouter currentPath={$currentPath} />
  </div>

  <!-- Modals -->
  <CreateModal />
  <ShareModal />
  <CollaboratorsModal />
  <ForkModal />
  <BlossomPushModal />
  <Toast />
  {#if RenderScan}
    <RenderScan initialEnabled={false} />
  {/if}
</div>
