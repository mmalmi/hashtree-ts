<script lang="ts">
  /**
   * Simplified connectivity indicator - network icon with count
   * Red: not connected, Yellow: relays only, Green: peers connected
   * Clicking navigates to settings
   */
  import { appStore } from '../store';
  import { nostrStore } from '../nostr';

  let peers = $derived($appStore.peerCount);
  let connectedRelays = $derived($nostrStore.connectedRelays);
  let loggedIn = $derived($nostrStore.isLoggedIn);

  // Color logic: red = nothing, yellow = relays only, green = peers
  let color = $derived.by(() => {
    if (!loggedIn || connectedRelays === 0) return '#f85149'; // red
    if (peers === 0) return '#d29922'; // yellow
    return '#3fb950'; // green
  });

  let title = $derived.by(() => {
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
  class="flex items-center gap-1.5 px-2 py-1 text-sm no-underline"
  {title}
>
  <span
    data-testid="peer-indicator-dot"
    class="i-lucide-wifi"
    style="color: {color}"
  />
  <span data-testid="peer-count" style="color: {color}">{totalConnections}</span>
</a>
