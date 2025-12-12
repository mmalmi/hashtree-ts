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
  import { syncedStorageStore, refreshSyncedStorage, type UserStorageStats } from '../stores/chunkMetadata';
  import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../stores/settings';
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

  // Synced storage breakdown (reactive - updates when trees sync)
  let syncedStorage = $derived($syncedStorageStore);
  let syncedStorageTotal = $derived(syncedStorage.reduce((sum, s) => sum + s.bytes, 0));

  let relayList = $derived($nostrStore.relays);
  let relayStatuses = $derived($nostrStore.relayStatuses);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let myPubkey = $derived($nostrStore.pubkey);

  // Network settings
  let networkSettings = $derived($settingsStore.network);
  let newRelayUrl = $state('');
  let newBlossomUrl = $state('');
  let editingRelays = $state(false);
  let editingBlossom = $state(false);

  function addRelay() {
    const url = newRelayUrl.trim();
    if (!url) return;
    // Validate URL
    try {
      new URL(url);
      if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
        return;
      }
    } catch {
      return;
    }
    if (!networkSettings.relays.includes(url)) {
      settingsStore.setNetworkSettings({
        relays: [...networkSettings.relays, url],
      });
    }
    newRelayUrl = '';
  }

  function removeRelay(url: string) {
    settingsStore.setNetworkSettings({
      relays: networkSettings.relays.filter(r => r !== url),
    });
  }

  function resetRelays() {
    settingsStore.setNetworkSettings({
      relays: DEFAULT_NETWORK_SETTINGS.relays,
    });
    editingRelays = false;
  }

  function addBlossomServer() {
    const url = newBlossomUrl.trim();
    if (!url) return;
    // Validate URL
    try {
      new URL(url);
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        return;
      }
    } catch {
      return;
    }
    if (!networkSettings.blossomServers.some(s => s.url === url)) {
      settingsStore.setNetworkSettings({
        blossomServers: [...networkSettings.blossomServers, { url, read: true, write: false }],
      });
    }
    newBlossomUrl = '';
  }

  function removeBlossomServer(url: string) {
    settingsStore.setNetworkSettings({
      blossomServers: networkSettings.blossomServers.filter(s => s.url !== url),
    });
  }

  function toggleBlossomRead(url: string) {
    settingsStore.setNetworkSettings({
      blossomServers: networkSettings.blossomServers.map(s =>
        s.url === url ? { ...s, read: !s.read } : s
      ),
    });
  }

  function toggleBlossomWrite(url: string) {
    settingsStore.setNetworkSettings({
      blossomServers: networkSettings.blossomServers.map(s =>
        s.url === url ? { ...s, write: !s.write } : s
      ),
    });
  }

  function resetBlossomServers() {
    settingsStore.setNetworkSettings({
      blossomServers: DEFAULT_NETWORK_SETTINGS.blossomServers,
    });
    editingBlossom = false;
  }

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

  // Subscribe to app store updates
  onMount(() => {
    updateStorageStats();
    refreshSyncedStorage(); // Load initial data into reactive store

    // Subscribe to store changes
    const unsub = useAppStore.subscribe((state) => {
      peerList = state.peers;
      stats = state.stats;
      myPeerId = state.myPeerId;
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
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide">
          Relays ({networkSettings.relays.length})
        </h3>
        <button
          onclick={() => editingRelays = !editingRelays}
          class="btn-ghost text-xs text-accent"
        >
          {editingRelays ? 'Done' : 'Edit'}
        </button>
      </div>
      <p class="text-xs text-text-3 mb-3">Nostr servers used to find peers and npub/path directories</p>
      <div class="bg-surface-2 rounded divide-y divide-surface-3">
        {#each networkSettings.relays as relay}
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
            {#if editingRelays}
              <button
                onclick={() => removeRelay(relay)}
                class="btn-ghost p-1 text-danger"
                title="Remove relay"
              >
                <span class="i-lucide-x text-sm"></span>
              </button>
            {:else}
              <span class="text-xs text-text-3">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if editingRelays}
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            bind:value={newRelayUrl}
            placeholder="wss://relay.example.com"
            class="flex-1 input text-sm"
            onkeydown={(e) => e.key === 'Enter' && addRelay()}
          />
          <button onclick={addRelay} class="btn-primary text-sm">Add</button>
        </div>
        <button onclick={resetRelays} class="btn-ghost mt-2 text-xs text-text-3">
          Reset to defaults
        </button>
      {/if}
    </div>

    <!-- Blossom Servers -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide">
          Blossom Servers ({networkSettings.blossomServers.length})
        </h3>
        <button
          onclick={() => editingBlossom = !editingBlossom}
          class="btn-ghost text-xs text-accent"
        >
          {editingBlossom ? 'Done' : 'Edit'}
        </button>
      </div>
      <p class="text-xs text-text-3 mb-3">Fallback servers for file storage</p>
      <div class="bg-surface-2 rounded divide-y divide-surface-3">
        {#each networkSettings.blossomServers as server}
          <div class="flex items-center gap-2 p-3 text-sm">
            <span class="i-lucide-server text-text-3 shrink-0"></span>
            <span class="text-text-1 truncate flex-1">
              {(() => {
                try {
                  return new URL(server.url).hostname;
                } catch {
                  return server.url;
                }
              })()}
            </span>
            <label class="flex items-center gap-1 text-xs text-text-3 cursor-pointer" title="Allow reads from this server">
              <input
                type="checkbox"
                checked={server.read}
                onchange={() => toggleBlossomRead(server.url)}
                class="accent-accent"
              />
              read
            </label>
            <label class="flex items-center gap-1 text-xs text-text-3 cursor-pointer" title="Allow uploads to this server">
              <input
                type="checkbox"
                checked={server.write}
                onchange={() => toggleBlossomWrite(server.url)}
                class="accent-accent"
              />
              write
            </label>
            {#if editingBlossom}
              <button
                onclick={() => removeBlossomServer(server.url)}
                class="btn-ghost p-1 text-danger"
                title="Remove server"
              >
                <span class="i-lucide-x text-sm"></span>
              </button>
            {/if}
          </div>
        {:else}
          <div class="p-3 text-sm text-text-3">No servers configured</div>
        {/each}
      </div>
      {#if editingBlossom}
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            bind:value={newBlossomUrl}
            placeholder="https://blossom.example.com"
            class="flex-1 input text-sm"
            onkeydown={(e) => e.key === 'Enter' && addBlossomServer()}
          />
          <button onclick={addBlossomServer} class="btn-primary text-sm">Add</button>
        </div>
        <button onclick={resetBlossomServers} class="btn-ghost mt-2 text-xs text-text-3">
          Reset to defaults
        </button>
      {/if}
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
    <div>
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
          Synced Storage
        </h3>
        <p class="text-xs text-text-3 mb-3">
          Autosynced trees ({formatBytes(syncedStorageTotal)} total)
        </p>
        <div class="bg-surface-2 rounded divide-y divide-surface-3" data-testid="synced-storage">
          {#each syncedStorage as userStats}
            {@const pubkey = (() => {
              try { return nip19.decode(userStats.npub).data as string; }
              catch { return ''; }
            })()}
            <a
              href="#/{userStats.npub}"
              class="flex items-center gap-2 p-3 text-sm hover:bg-surface-3 transition-colors"
            >
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
            </a>
          {/each}
        </div>
        {#if syncedStorage.length === 0}
          <p class="text-xs text-text-3 mt-2">No synced trees yet</p>
        {/if}
      </div>

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
