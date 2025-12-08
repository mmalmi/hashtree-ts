<script lang="ts">
  /**
   * SettingsPage - app settings
   * Port of React SettingsPanel
   */
  import { onMount } from 'svelte';
  import { nostrStore } from '../nostr';
  import { useAppStore, formatBytes, updateStorageStats } from '../store';

  let relayList = $derived($nostrStore.relays);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // App store
  let peerList = $derived(useAppStore.getState().peers);
  let peerCount = $derived(useAppStore.getState().peerCount);
  let stats = $derived(useAppStore.getState().stats);

  // Subscribe to app store updates
  onMount(() => {
    updateStorageStats();

    // Subscribe to store changes
    const unsub = useAppStore.subscribe((state) => {
      peerList = state.peers;
      peerCount = state.peerCount;
      stats = state.stats;
    });
    return unsub;
  });

  function navigate(path: string) {
    window.location.hash = path;
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="h-12 px-4 flex items-center gap-3 border-b border-surface-3 bg-surface-1 shrink-0">
    <button onclick={() => navigate('/')} class="btn-ghost p-2">
      <span class="i-lucide-arrow-left"></span>
    </button>
    <span class="font-semibold text-text-1">Settings</span>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 space-y-6 w-full max-w-md mx-auto">
    <!-- Relays -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
        Relays ({relayList.length})
        <span
          class="i-lucide-info text-sm cursor-help"
          title="Relays are used to find peers"
        ></span>
      </h3>
      <div class="bg-surface-2 rounded divide-y divide-surface-3">
        {#each relayList as relay}
          <div class="flex items-center gap-2 p-3 text-sm">
            <span class="w-2 h-2 rounded-full bg-success shrink-0"></span>
            <span class="text-text-1 truncate">
              {(() => {
                try {
                  return new URL(relay).hostname;
                } catch {
                  return relay;
                }
              })()}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Peers -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
        Peers ({peerCount})
        <span
          class="i-lucide-info text-sm cursor-help"
          title="Peers are used to exchange data"
        ></span>
      </h3>
      {#if !isLoggedIn}
        <div class="bg-surface-2 rounded p-3 text-sm text-muted">
          Login to connect with peers
        </div>
      {:else if peerList.length === 0}
        <div class="bg-surface-2 rounded p-3 text-sm text-muted">
          No peers connected
        </div>
      {:else}
        <div class="bg-surface-2 rounded divide-y divide-surface-3">
          {#each peerList as peer}
            <div class="flex items-center gap-2 p-3 text-sm">
              <span class="w-2 h-2 rounded-full shrink-0 {peer.state === 'connected' ? 'bg-success' : peer.state === 'connecting' ? 'bg-warning' : 'bg-error'}"></span>
              <span class="text-text-1 truncate flex-1">{peer.state}</span>
              <span class="text-xs text-muted font-mono">{peer.peerId.slice(0, 8)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Local Storage -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-3">
        Local Storage
      </h3>
      <div class="bg-surface-2 rounded p-3 text-sm space-y-2">
        <div class="flex justify-between">
          <span class="text-muted">Items</span>
          <span class="text-text-1">{stats.items.toLocaleString()}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">Size</span>
          <span class="text-text-1">{formatBytes(stats.bytes)}</span>
        </div>
      </div>
    </div>

    <!-- About -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-3">
        About
      </h3>
      <p class="text-sm text-text-2">
        hashtree - Content-addressed file storage on Nostr
      </p>
    </div>
  </div>
</div>
