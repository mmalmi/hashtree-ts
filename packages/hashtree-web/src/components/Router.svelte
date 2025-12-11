<script lang="ts">
  /**
   * Router component that handles route matching and rendering
   * Receives currentPath as a prop to ensure proper reactivity
   */
  import { matchRoute, currentFullHash } from '../lib/router.svelte';

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
  import PullRequestDetailView from './Git/PullRequestDetailView.svelte';
  import IssueDetailView from './Git/IssueDetailView.svelte';

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
    // Generic tree routes
    { pattern: '/:npub/:treeName/*', component: TreeRoute },
    { pattern: '/:npub/:treeName', component: TreeRoute },
    { pattern: '/:id/*', component: UserRoute },
    { pattern: '/:id', component: UserRoute },
  ];

  // Check for ?tab=pulls or ?tab=issues query param (NIP-34 git repo views)
  // Also check for ?id= to show individual PR/Issue detail views
  // This allows PR/Issues views without interfering with actual directory names
  function parseNip34Query(fullHash: string): { tab: 'pulls' | 'issues'; id?: string } | null {
    const qIdx = fullHash.indexOf('?');
    if (qIdx === -1) return null;
    const params = new URLSearchParams(fullHash.slice(qIdx + 1));
    const tab = params.get('tab');
    if (tab === 'pulls' || tab === 'issues') {
      const id = params.get('id') || undefined;
      return { tab, id };
    }
    return null;
  }

  interface Props {
    currentPath: string;
  }

  let { currentPath }: Props = $props();

  // Subscribe to full hash for query param detection
  let fullHash = $derived($currentFullHash);

  // Check for NIP-34 tab query param (?tab=pulls or ?tab=issues) and optional id
  let nip34Query = $derived(parseNip34Query(fullHash));

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

  // For NIP-34 views, we need npub and treeName from the current route
  // The repo path is treeName + any wild path
  let nip34RepoPath = $derived.by(() => {
    if (!nip34Query) return '';
    const { treeName, wild } = route.params;
    if (!treeName) return '';
    return wild ? `${treeName}/${wild}` : treeName;
  });
</script>

<div class="flex-1 flex flex-col lg:flex-row min-h-0">
  {#if nip34Query?.tab === 'pulls' && nip34Query.id && route.params.npub && route.params.treeName}
    <PullRequestDetailView npub={route.params.npub} repoName={nip34RepoPath} prId={nip34Query.id} />
  {:else if nip34Query?.tab === 'issues' && nip34Query.id && route.params.npub && route.params.treeName}
    <IssueDetailView npub={route.params.npub} repoName={nip34RepoPath} issueId={nip34Query.id} />
  {:else if nip34Query?.tab === 'pulls' && route.params.npub && route.params.treeName}
    <PullRequestsView npub={route.params.npub} repoName={nip34RepoPath} />
  {:else if nip34Query?.tab === 'issues' && route.params.npub && route.params.treeName}
    <IssuesView npub={route.params.npub} repoName={nip34RepoPath} />
  {:else if route.component === HomeRoute}
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
  {:else if route.component === TreeRoute}
    <TreeRoute npub={route.params.npub} treeName={route.params.treeName} wild={route.params.wild} />
  {:else if route.component === UserRoute}
    <UserRoute id={route.params.id || route.params.npub} wild={route.params.wild} />
  {:else}
    <HomeRoute />
  {/if}
</div>
