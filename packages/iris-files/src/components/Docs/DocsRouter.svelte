<script lang="ts">
  /**
   * DocsRouter - Router for the docs app
   * Routes:
   * - / : Home (recent docs, followed users' docs)
   * - /settings : Settings page
   * - /users : User list (switch user)
   * - /:npub/edit : Edit profile page
   * - /:npub/profile : Profile page
   * - /:npub/:treeName/... : Document view
   */
  import { matchRoute } from '../../lib/router.svelte';
  import DocsHome from './DocsHome.svelte';
  import DocView from './DocView.svelte';
  import SettingsPage from '../SettingsPage.svelte';
  import ProfileView from '../ProfileView.svelte';
  import EditProfilePage from '../EditProfilePage.svelte';
  import UsersPage from '../UsersPage.svelte';

  const routePatterns = [
    { pattern: '/', component: DocsHome },
    { pattern: '/settings', component: SettingsPage },
    { pattern: '/users', component: UsersPage },
    { pattern: '/:npub/edit', component: EditProfilePage },
    { pattern: '/:npub/profile', component: ProfileView },
    { pattern: '/:npub/:treeName/*', component: DocView },
    { pattern: '/:npub/:treeName', component: DocView },
    { pattern: '/:npub', component: DocsHome }, // User's docs
  ];

  interface Props {
    currentPath: string;
  }

  let { currentPath }: Props = $props();

  // Match route
  let matchedRoute = $derived.by(() => {
    for (const route of routePatterns) {
      const match = matchRoute(route.pattern, currentPath);
      if (match.matched) {
        return { component: route.component, params: match.params };
      }
    }
    return { component: DocsHome, params: {} };
  });
</script>

<svelte:component this={matchedRoute.component} {...matchedRoute.params} />
