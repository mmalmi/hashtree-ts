<script lang="ts">
  /**
   * SettingsPage - app settings
   * Port of React SettingsPanel
   */
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { nostrStore, type RelayStatus, getNsec } from '../nostr';
  import { useAppStore, formatBytes, updateStorageStats } from '../store';
  import { socialGraphStore, getGraphSize, getFollows } from '../utils/socialGraph';
  import { getStorageBreakdown, type UserStorageStats } from '../stores/chunkMetadata';
  import { BackButton } from './ui';
  import { UserRow } from './User';

  // Check if user is logged in with nsec (can copy secret key)
  let nsec = $derived(getNsec());
  let copiedNsec = $state(false);

  async function copySecretKey() {
    const key = getNsec();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      copiedNsec = true;
      setTimeout(() => (copiedNsec = false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  // Synced storage breakdown
  let syncedStorage = $state<UserStorageStats[]>([]);
  let syncedStorageTotal = $derived(syncedStorage.reduce((sum, s) => sum + s.bytes, 0));

  async function loadSyncedStorage() {
    syncedStorage = await getStorageBreakdown();
  }

  let relayList = $derived($nostrStore.relays);
  let relayStatuses = $derived($nostrStore.relayStatuses);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let myPubkey = $derived($nostrStore.pubkey);

  // Social graph stats
  let isRecrawling = $derived($socialGraphStore.isRecrawling);
  let graphSize = $derived(getGraphSize());
  let myFollowsCount = $derived(myPubkey ? getFollows(myPubkey).size : 0);

  // Re-derive when graph version changes
  $effect(() => {
    $socialGraphStore.version;
    graphSize = getGraphSize();
    myFollowsCount = myPubkey ? getFollows(myPubkey).size : 0;
  });

  function getStatusColor(status: RelayStatus): string {
    switch (status) {
      case 'connected': return 'bg-success';
      case 'connecting': return 'bg-warning';
      case 'error': return 'bg-danger';
      default: return 'bg-text-3';
    }
  }

  function getRelayStatus(url: string): RelayStatus {
    // Normalize URL for lookup (remove trailing slash)
    const normalized = url.replace(/\/$/, '');
    return relayStatuses.get(normalized) || relayStatuses.get(url) || 'disconnected';
  }

  // App store
  let peerList = $derived(useAppStore.getState().peers);
  let stats = $derived(useAppStore.getState().stats);
  let myPeerId = $derived(useAppStore.getState().myPeerId);
  let wsFallback = $derived(useAppStore.getState().wsFallback);

  // Subscribe to app store updates
  onMount(() => {
    updateStorageStats();
    loadSyncedStorage();

    // Subscribe to store changes
    const unsub = useAppStore.subscribe((state) => {
      peerList = state.peers;
      stats = state.stats;
      myPeerId = state.myPeerId;
      wsFallback = state.wsFallback;
    });
    return unsub;
  });

  // Helper function to extract uuid from peerId (format: "pubkey:uuid")
  function getPeerUuid(peerId: string): string {
    return peerId.split(':')[1] || peerId;
  }

  // Helper function to get state color
  function stateColor(state: string): string {
    switch (state) {
      case 'connected': return '#3fb950';
      case 'connecting': return '#d29922';
      case 'failed': return '#f85149';
      default: return '#8b949e';
    }
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="h-12 px-4 flex items-center gap-3 border-b border-surface-3 bg-surface-1 shrink-0">
    <BackButton href="/" />
    <span class="font-semibold text-text-1">Settings</span>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 space-y-6 w-full max-w-md mx-auto">
    <!-- Relays -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        Relays ({relayList.length})
      </h3>
      <p class="text-xs text-text-3 mb-3">Nostr servers used to find peers</p>
      <div class="bg-surface-2 rounded divide-y divide-surface-3">
        {#each relayList as relay}
          {@const status = getRelayStatus(relay)}
          <div class="flex items-center gap-2 p-3 text-sm">
            <span class="w-2 h-2 rounded-full {getStatusColor(status)} shrink-0"></span>
            <span class="text-text-1 truncate flex-1">
              {(() => {
                try {
                  return new URL(relay).hostname;
                } catch {
                  return relay;
                }
              })()}
            </span>
            <span class="text-xs text-text-3">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
          </div>
        {/each}
        {#if wsFallback.url}
          <div class="flex items-center gap-2 p-3 text-sm">
            <span class="w-2 h-2 rounded-full {wsFallback.connected ? 'bg-success' : 'bg-text-3'} shrink-0"></span>
            <span class="text-text-1 truncate flex-1">
              {(() => {
                try {
                  return new URL(wsFallback.url).hostname;
                } catch {
                  return wsFallback.url;
                }
              })()}
            </span>
            <span class="text-xs text-text-3">{wsFallback.connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Peers -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        Peers ({peerList.length})
      </h3>
      <p class="text-xs text-text-3 mb-3">WebRTC connections for file exchange</p>
      {#if myPeerId}
        <div class="text-xs text-muted mb-2 font-mono">
          Your ID: {myPeerId}
        </div>
      {/if}
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
            <a
              href="#/{nip19.npubEncode(peer.pubkey)}"
              class="flex items-center gap-2 p-3 text-sm hover:bg-surface-3 transition-colors"
            >
              <span
                class="w-2 h-2 rounded-full shrink-0"
                style="background: {stateColor(peer.state)}"
              ></span>
              <UserRow
                pubkey={peer.pubkey}
                description={peer.isSelf ? 'You' : `${peer.state}${peer.pool === 'follows' ? ' (follow)' : ''}`}
                avatarSize={32}
                showBadge
                class="flex-1 min-w-0"
              />
              <span class="text-xs text-muted font-mono shrink-0">
                {getPeerUuid(peer.peerId).slice(0, 8)}
              </span>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Social Graph -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1 flex items-center gap-2">
        Social Graph
        {#if isRecrawling}
          <span class="text-xs text-accent animate-pulse">crawling...</span>
        {/if}
      </h3>
      <p class="text-xs text-text-3 mb-3">Follow network used for trust indicators</p>
      <div class="bg-surface-2 rounded p-3 text-sm space-y-2">
        <div class="flex justify-between">
          <span class="text-muted">Users in graph</span>
          <span class="text-text-1">{graphSize.toLocaleString()}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">Following</span>
          <span class="text-text-1">{myFollowsCount.toLocaleString()}</span>
        </div>
      </div>
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

    <!-- Synced Storage (from background sync) -->
    {#if syncedStorage.length > 0}
      <div>
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
          Synced Storage
        </h3>
        <p class="text-xs text-text-3 mb-3">
          Background-synced trees ({formatBytes(syncedStorageTotal)} total)
        </p>
        <div class="bg-surface-2 rounded divide-y divide-surface-3" data-testid="synced-storage">
          {#each syncedStorage as userStats}
            {@const pubkey = (() => {
              try { return nip19.decode(userStats.npub).data as string; }
              catch { return ''; }
            })()}
            <div class="flex items-center gap-2 p-3 text-sm">
              {#if pubkey}
                <UserRow
                  pubkey={pubkey}
                  description={`${userStats.treeCount} tree${userStats.treeCount > 1 ? 's' : ''}`}
                  avatarSize={28}
                  showBadge
                  class="flex-1 min-w-0"
                />
              {:else}
                <span class="flex-1 text-muted truncate">{userStats.npub.slice(0, 16)}...</span>
              {/if}
              <span class="text-xs text-muted shrink-0">
                {formatBytes(userStats.bytes)}
              </span>
              {#if userStats.isOwn}
                <span class="text-xs text-accent">(you)</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Account (only show when logged in with nsec) -->
    {#if nsec}
      <div>
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-3">
          Account
        </h3>
        <div class="bg-surface-2 rounded p-3">
          <button
            onclick={copySecretKey}
            class="btn-ghost flex items-center gap-2 text-sm w-full justify-start"
            data-testid="copy-secret-key"
          >
            {#if copiedNsec}
              <span class="i-lucide-check text-success"></span>
              <span>Copied!</span>
            {:else}
              <span class="i-lucide-key"></span>
              <span>Copy secret key</span>
            {/if}
          </button>
        </div>
      </div>
    {/if}

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
