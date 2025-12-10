<script lang="ts">
  /**
   * Simplified connectivity indicator - network icon with count
   * Red: not connected, Yellow: relays only, Green: peers connected
   * Shows "offline" text when browser is offline
   * Clicking navigates to settings
   */
  import { appStore } from '../store';
  import { nostrStore } from '../nostr';

  let peers = $derived($appStore.peerCount);
  let connectedRelays = $derived($nostrStore.connectedRelays);
  let loggedIn = $derived($nostrStore.isLoggedIn);

  // Track browser online/offline status
  let isOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);

  $effect(() => {
    const handleOnline = () => { isOnline = true; };
    const handleOffline = () => { isOnline = false; };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  });

  // Color logic: red = nothing/offline, yellow = relays only, green = peers
  let color = $derived.by(() => {
    if (!isOnline) return '#f85149'; // red when offline
    if (!loggedIn || connectedRelays === 0) return '#f85149'; // red
    if (peers === 0) return '#d29922'; // yellow
    return '#3fb950'; // green
  });

  let title = $derived.by(() => {
    if (!isOnline) return 'Offline';
    if (!loggedIn) return 'Not connected';
    if (connectedRelays === 0) return 'No relays connected';
    if (peers === 0) return `${connectedRelays} relay${connectedRelays !== 1 ? 's' : ''}, no peers`;
    return `${peers} peer${peers !== 1 ? 's' : ''}, ${connectedRelays} relay${connectedRelays !== 1 ? 's' : ''}`;
  });

  // Total connections = relays + peers
  let totalConnections = $derived(connectedRelays + peers);
</script>

<a
  href="#/settings"
  class="flex flex-col items-center px-2 py-1 text-sm no-underline"
  {title}
>
  <div class="flex items-center gap-1.5">
    <span
      data-testid="peer-indicator-dot"
      class="i-lucide-wifi"
      style="color: {color}"
    ></span>
    <span data-testid="peer-count" style="color: {color}">{totalConnections}</span>
  </div>
  {#if !isOnline}
    <span class="text-[10px] text-danger -mt-0.5">offline</span>
  {/if}
</a>
