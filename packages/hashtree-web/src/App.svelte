<script lang="ts">
  import { location, matchRoute } from './lib/router';
  import { nostrStore } from './nostr';
  import Logo from './components/Logo.svelte';
  import NostrLogin from './components/NostrLogin.svelte';
  import ConnectivityIndicator from './components/ConnectivityIndicator.svelte';
  import SearchInput from './components/SearchInput.svelte';
  import MobileSearch from './components/MobileSearch.svelte';
  import WalletLink from './components/WalletLink.svelte';
  import FileBrowser from './components/FileBrowser.svelte';
  import Viewer from './components/Viewer/Viewer.svelte';
  import RecentsView from './components/RecentsView.svelte';
  import FollowsTreesView from './components/FollowsTreesView.svelte';
  import Toast from './components/Toast.svelte';

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

  // Page components
  import SettingsPage from './components/SettingsPage.svelte';
  import WalletPage from './components/WalletPage.svelte';
  import UsersPage from './components/UsersPage.svelte';
  import ProfileView from './components/ProfileView.svelte';
  import FollowsPage from './components/FollowsPage.svelte';
  import EditProfilePage from './components/EditProfilePage.svelte';

  // Route handlers
  import HomeRoute from './routes/HomeRoute.svelte';
  import TreeRoute from './routes/TreeRoute.svelte';
  import NHashRoute from './routes/NHashRoute.svelte';
  import NPathRoute from './routes/NPathRoute.svelte';
  import UserRoute from './routes/UserRoute.svelte';

  // Route definitions with patterns
  const routePatterns = [
    { pattern: '/', component: HomeRoute },
    { pattern: '/settings', component: SettingsPage },
    { pattern: '/wallet', component: WalletPage },
    { pattern: '/users', component: UsersPage },
    { pattern: '/:npub/follows', component: FollowsPage },
    { pattern: '/:npub/edit', component: EditProfilePage },
    { pattern: '/:npub/profile', component: UserRoute },  // Profile shows trees + profile view
    { pattern: '/:npub/:treeName/*', component: TreeRoute },
    { pattern: '/:npub/:treeName', component: TreeRoute },
    { pattern: '/:id/*', component: UserRoute },
    { pattern: '/:id', component: UserRoute },
  ];

  // Handle fullscreen mode from URL
  function isFullscreen(): boolean {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return params.get('fullscreen') === '1';
  }

  function clearFullscreen() {
    const hash = window.location.hash.split('?')[0];
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    params.delete('fullscreen');
    const queryString = params.toString();
    window.location.hash = queryString ? `${hash}?${queryString}` : hash;
  }

  // Find matching route
  function findRoute(path: string) {
    for (const route of routePatterns) {
      const match = matchRoute(route.pattern, path);
      if (match.matched) {
        return { component: route.component, params: match.params };
      }
    }
    return { component: HomeRoute, params: {} };
  }

  let currentPath = $derived($location);
  let routeMatch = $derived(findRoute(currentPath));
  let fullscreen = $state(isFullscreen());

  // Update fullscreen on hash change
  $effect(() => {
    currentPath; // Subscribe to path changes
    fullscreen = isFullscreen();
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
  {#if !fullscreen}
    <header class="h-12 shrink-0 bg-surface-1 border-b border-surface-3 flex items-center justify-between px-3 md:px-4 gap-2 relative">
      <a href="#/" onclick={handleLogoClick} class="no-underline">
        <Logo />
      </a>
      <div class="flex items-center gap-2 md:gap-3">
        <MobileSearch />
        <div class="hidden md:block"><SearchInput /></div>
        <ConnectivityIndicator />
        <WalletLink />
        <NostrLogin />
      </div>
    </header>
  {/if}

  <!-- Main area -->
  <div class="flex-1 flex flex-col min-h-0">
    <!-- Routes -->
    <div class="flex-1 flex flex-col lg:flex-row min-h-0">
      {#if routeMatch.component === HomeRoute}
        <HomeRoute />
      {:else if routeMatch.component === SettingsPage}
        <SettingsPage />
      {:else if routeMatch.component === WalletPage}
        <WalletPage />
      {:else if routeMatch.component === UsersPage}
        <UsersPage />
      {:else if routeMatch.component === FollowsPage}
        <FollowsPage npub={routeMatch.params.npub} />
      {:else if routeMatch.component === EditProfilePage}
        <EditProfilePage npub={routeMatch.params.npub} />
      {:else if routeMatch.component === ProfileView}
        <ProfileView npub={routeMatch.params.npub || ''} />
      {:else if routeMatch.component === TreeRoute}
        <TreeRoute npub={routeMatch.params.npub} treeName={routeMatch.params.treeName} wild={routeMatch.params.wild} />
      {:else if routeMatch.component === UserRoute}
        <UserRoute id={routeMatch.params.id || routeMatch.params.npub} wild={routeMatch.params.wild} />
      {:else}
        <HomeRoute />
      {/if}
    </div>
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
  <Toast />
</div>
