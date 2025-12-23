<script lang="ts">
  /**
   * VideoRouter - Router for the video app
   * Routes:
   * - / : Home (recent videos, followed users' videos)
   * - /settings : Settings page
   * - /users : User list (switch user)
   * - /:nhash : Permalink to video (content-addressed)
   * - /:npub/edit : Edit profile page
   * - /:npub/profile : Profile page (alias)
   * - /:npub/follows : Following list
   * - /:npub/followers : Followers list
   * - /:npub/:treeName : Video view
   * - /:npub : Profile with videos (channel)
   */
  import { matchRoute } from '../../lib/router.svelte';
  import { isNHash } from 'hashtree';
  import VideoHome from './VideoHome.svelte';
  import VideoProfileView from './VideoProfileView.svelte';
  import VideoView from './VideoView.svelte';
  import VideoNHashView from './VideoNHashView.svelte';
  import SettingsPage from '../SettingsPage.svelte';
  import EditProfilePage from '../EditProfilePage.svelte';
  import UsersPage from '../UsersPage.svelte';
  import FollowsPage from '../FollowsPage.svelte';
  import FollowersPage from '../FollowersPage.svelte';

  const routePatterns = [
    { pattern: '/', component: VideoHome },
    { pattern: '/settings', component: SettingsPage },
    { pattern: '/users', component: UsersPage },
    { pattern: '/:npub/edit', component: EditProfilePage },
    { pattern: '/:npub/profile', component: VideoProfileView },
    { pattern: '/:npub/follows', component: FollowsPage },
    { pattern: '/:npub/followers', component: FollowersPage },
    // Note: videoName can contain slashes for playlist paths like "Channel/videoId"
    // Uses wildcard * to capture the rest of the path as 'wild' param
    { pattern: '/:npub/videos/*', component: VideoView },
    { pattern: '/:npub', component: VideoProfileView },
  ];

  interface Props {
    currentPath: string;
  }

  let { currentPath }: Props = $props();

  // Match route
  let matchedRoute = $derived.by(() => {
    // Check for nhash first (content-addressed permalink)
    const parts = currentPath.split('/').filter(Boolean);
    if (parts[0] && isNHash(parts[0])) {
      return { component: VideoNHashView, params: { nhash: parts[0] } };
    }

    for (const route of routePatterns) {
      const match = matchRoute(route.pattern, currentPath);
      if (match.matched) {
        return { component: route.component, params: match.params };
      }
    }
    return { component: VideoHome, params: {} };
  });
</script>

<svelte:component this={matchedRoute.component} {...matchedRoute.params} />
