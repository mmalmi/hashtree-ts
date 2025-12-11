<script lang="ts">
  import { onMount } from 'svelte';
  import Logo from './components/Logo.svelte';
  import NostrLogin from './components/NostrLogin.svelte';
  import ConnectivityIndicator from './components/ConnectivityIndicator.svelte';
  import SearchInput from './components/SearchInput.svelte';
  import MobileSearch from './components/MobileSearch.svelte';
  // import WalletLink from './components/WalletLink.svelte';
  import Toast from './components/Toast.svelte';
  import Router from './components/Router.svelte';
  import { currentPath, initRouter, getQueryParams } from './lib/router.svelte';

  // Modal components
  import CreateModal from './components/Modals/CreateModal.svelte';
  import RenameModal from './components/Modals/RenameModal.svelte';
  import ForkModal from './components/Modals/ForkModal.svelte';
  import ExtractModal from './components/Modals/ExtractModal.svelte';
  import GitignoreModal from './components/Modals/GitignoreModal.svelte';
  import GitHistoryModal from './components/Modals/GitHistoryModal.svelte';
  import ShareModal from './components/Modals/ShareModal.svelte';
  import CollaboratorsModal from './components/Modals/CollaboratorsModal.svelte';
  import UnsavedChangesModal from './components/Modals/UnsavedChangesModal.svelte';
  import NewPullRequestModal from './components/Git/NewPullRequestModal.svelte';
  import NewIssueModal from './components/Git/NewIssueModal.svelte';

  // Handle fullscreen mode from URL
  function isFullscreen(): boolean {
    const params = getQueryParams();
    return params.get('fullscreen') === '1';
  }

  function clearFullscreen() {
    const hash = window.location.hash.split('?')[0];
    const params = getQueryParams();
    params.delete('fullscreen');
    const queryString = params.toString();
    window.location.hash = queryString ? `${hash}?${queryString}` : hash;
  }

  // Fullscreen state - check on each path change
  let fullscreen = $derived(isFullscreen());

  // Initialize router on mount
  onMount(() => {
    initRouter();
  });

  function handleLogoClick(e: MouseEvent) {
    if (fullscreen) {
      e.preventDefault();
      clearFullscreen();
    }
  }
</script>

<div class="h-full flex flex-col bg-surface-0">
  <!-- Top bar -->
  <header class="h-12 shrink-0 bg-surface-1 border-b border-surface-3 flex items-center justify-between px-3 md:px-4 gap-2 relative">
    <a href="#/" onclick={handleLogoClick} class="no-underline">
      <Logo />
    </a>
    <div class="flex items-center gap-2 md:gap-3">
      <MobileSearch />
      <div class="hidden md:block"><SearchInput /></div>
      <ConnectivityIndicator />
      <!-- <WalletLink /> -->
      <NostrLogin />
    </div>
  </header>

  <!-- Main area -->
  <div class="flex-1 flex flex-col min-h-0">
    <Router currentPath={$currentPath} />
  </div>

  <!-- Modals -->
  <CreateModal />
  <RenameModal />
  <ForkModal />
  <ExtractModal />
  <GitignoreModal />
  <GitHistoryModal />
  <ShareModal />
  <CollaboratorsModal />
  <UnsavedChangesModal />
  <NewPullRequestModal />
  <NewIssueModal />
  <Toast />
</div>
