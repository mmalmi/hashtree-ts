<script lang="ts">
  /**
   * Router component that handles route matching and rendering
   * Receives currentPath as a prop to ensure proper reactivity
   */
  import { matchRoute } from '../lib/router.svelte';

  // Page components
  import SettingsPage from './SettingsPage.svelte';
  import WalletPage from './WalletPage.svelte';
  import UsersPage from './UsersPage.svelte';
  import ProfileView from './ProfileView.svelte';
  import FollowsPage from './FollowsPage.svelte';
  import FollowersPage from './FollowersPage.svelte';
  import EditProfilePage from './EditProfilePage.svelte';

  // Route handlers
  import HomeRoute from '../routes/HomeRoute.svelte';
  import TreeRoute from '../routes/TreeRoute.svelte';
  import UserRoute from '../routes/UserRoute.svelte';

  // Git repository views (NIP-34)
  import PullRequestsView from './Git/PullRequestsView.svelte';
  import IssuesView from './Git/IssuesView.svelte';

  // Route definitions with patterns
  // Note: More specific routes must come before less specific ones
  const routePatterns = [
    { pattern: '/', component: HomeRoute },
    { pattern: '/settings', component: SettingsPage },
    { pattern: '/wallet', component: WalletPage },
    { pattern: '/users', component: UsersPage },
    { pattern: '/:npub/follows', component: FollowsPage },
    { pattern: '/:npub/followers', component: FollowersPage },
    { pattern: '/:npub/edit', component: EditProfilePage },
    { pattern: '/:npub/profile', component: UserRoute },
    // NIP-34 Git repository routes (must be before generic tree routes)
    { pattern: '/:npub/:treeName/pulls/*', component: PullRequestsView },
    { pattern: '/:npub/:treeName/pulls', component: PullRequestsView },
    { pattern: '/:npub/:treeName/issues/*', component: IssuesView },
    { pattern: '/:npub/:treeName/issues', component: IssuesView },
    // Generic tree routes
    { pattern: '/:npub/:treeName/*', component: TreeRoute },
    { pattern: '/:npub/:treeName', component: TreeRoute },
    { pattern: '/:id/*', component: UserRoute },
    { pattern: '/:id', component: UserRoute },
  ];

  interface Props {
    currentPath: string;
  }

  let { currentPath }: Props = $props();

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

  // Derive route from path prop
  let route = $derived.by(() => findRoute(currentPath));
</script>

<div class="flex-1 flex flex-col lg:flex-row min-h-0">
  {#if route.component === HomeRoute}
    <HomeRoute />
  {:else if route.component === SettingsPage}
    <SettingsPage />
  {:else if route.component === WalletPage}
    <WalletPage />
  {:else if route.component === UsersPage}
    <UsersPage />
  {:else if route.component === FollowsPage}
    <FollowsPage npub={route.params.npub} />
  {:else if route.component === FollowersPage}
    <FollowersPage npub={route.params.npub} />
  {:else if route.component === EditProfilePage}
    <EditProfilePage npub={route.params.npub} />
  {:else if route.component === ProfileView}
    <ProfileView npub={route.params.npub || ''} />
  {:else if route.component === PullRequestsView}
    <PullRequestsView npub={route.params.npub} repoName={route.params.treeName} />
  {:else if route.component === IssuesView}
    <IssuesView npub={route.params.npub} repoName={route.params.treeName} />
  {:else if route.component === TreeRoute}
    <TreeRoute npub={route.params.npub} treeName={route.params.treeName} wild={route.params.wild} />
  {:else if route.component === UserRoute}
    <UserRoute id={route.params.id || route.params.npub} wild={route.params.wild} />
  {:else}
    <HomeRoute />
  {/if}
</div>
