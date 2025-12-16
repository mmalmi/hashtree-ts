<script lang="ts">
  /**
   * SettingsPage - app settings
   * Port of React SettingsPanel
   */
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { nostrStore, type RelayStatus, getNsec } from '../nostr';
  import { appStore, formatBytes, updateStorageStats, refreshWebRTCStats } from '../store';
  import { socialGraphStore, getGraphSize, getFollows } from '../utils/socialGraph';
  import { syncedStorageStore, refreshSyncedStorage, type UserStorageStats } from '../stores/chunkMetadata';
  import { settingsStore, DEFAULT_NETWORK_SETTINGS, DEFAULT_POOL_SETTINGS } from '../stores/settings';
  import { blossomLogStore } from '../stores/blossomLog';
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
  let discoveredRelays = $derived($nostrStore.discoveredRelays);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let myPubkey = $derived($nostrStore.pubkey);

  // Collapsible state for discovered relays
  let showDiscoveredRelays = $state(false);

  // Network settings
  let networkSettings = $derived($settingsStore.network);
  let newRelayUrl = $state('');
  let newBlossomUrl = $state('');
  let editingRelays = $state(false);
  let editingBlossom = $state(false);

  // Pool settings
  let poolSettings = $derived($settingsStore.pools);

  // Blossom log
  let blossomLogs = $derived($blossomLogStore);

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

  // Social graph stats - depend on version to trigger re-computation
  let isRecrawling = $derived($socialGraphStore.isRecrawling);
  let graphSize = $derived.by(() => {
    $socialGraphStore.version; // Track version changes
    return getGraphSize();
  });
  let myFollowsCount = $derived.by(() => {
    $socialGraphStore.version; // Track version changes
    return myPubkey ? getFollows(myPubkey).size : 0;
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

  // App store - use $derived from the store directly
  let appState = $derived($appStore);
  let peerList = $derived(appState.peers);
  let stats = $derived(appState.stats);
  let myPeerId = $derived(appState.myPeerId);
  let webrtcStats = $derived(appState.webrtcStats);
  let perPeerStats = $derived(appState.perPeerStats);

  // Load initial data on mount and refresh stats periodically
  onMount(() => {
    updateStorageStats();
    refreshSyncedStorage();
    refreshWebRTCStats();

    // Refresh WebRTC stats every second while on settings page
    const statsInterval = setInterval(refreshWebRTCStats, 1000);
    return () => clearInterval(statsInterval);
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

  // Helper function to get peer stats
  function getPeerStats(peerId: string) {
    return perPeerStats?.get(peerId)?.stats;
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="border-b border-surface-3 shrink-0">
    <div class="h-12 px-4 flex items-center gap-3 w-full max-w-2xl mx-auto">
      <BackButton href="/" useHistory />
      <span class="font-semibold text-text-1">Settings</span>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 space-y-6 w-full max-w-2xl mx-auto">
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

      <!-- Discovered Relays (collapsible) -->
      {#if discoveredRelays.length > 0}
        <div class="bg-surface-2 rounded mt-1">
          <button
            onclick={() => showDiscoveredRelays = !showDiscoveredRelays}
            class="btn-ghost b-0 flex items-center gap-1 p-3 text-sm text-text-1 w-full"
          >
            <span class="i-lucide-chevron-right text-sm transition-transform {showDiscoveredRelays ? 'rotate-90' : ''}"></span>
            Discovered relays ({discoveredRelays.length})
          </button>
          {#if showDiscoveredRelays}
            <div class="divide-y divide-surface-3">
            {#each discoveredRelays as relay}
              <div class="flex items-center gap-2 p-3 text-sm">
                <span class="w-2 h-2 rounded-full {getStatusColor(relay.status)} shrink-0"></span>
                <span class="text-text-1 truncate flex-1">
                  {(() => {
                    try {
                      return new URL(relay.url).hostname;
                    } catch {
                      return relay.url;
                    }
                  })()}
                </span>
                <span class="text-xs text-text-3">{relay.status.charAt(0).toUpperCase() + relay.status.slice(1)}</span>
              </div>
            {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- File Servers -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-xs font-medium text-muted uppercase tracking-wide">
          File Servers ({networkSettings.blossomServers.length})
        </h3>
        <button
          onclick={() => editingBlossom = !editingBlossom}
          class="btn-ghost text-xs text-accent"
        >
          {editingBlossom ? 'Done' : 'Edit'}
        </button>
      </div>
      <p class="text-xs text-text-3 mb-3">
        <a href="https://github.com/hzrd149/blossom" target="_blank" rel="noopener" class="text-accent hover:underline">Blossom</a> servers for fallback when peer-to-peer (WebRTC) connections are unavailable
      </p>
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

      <!-- Blossom Log -->
      {#if blossomLogs.length > 0}
        <div class="mt-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-text-3">Recent activity</span>
            <button onclick={() => blossomLogStore.clear()} class="btn-ghost text-xs text-text-3">Clear</button>
          </div>
          <div class="bg-surface-3 rounded text-xs font-mono max-h-32 overflow-y-auto overflow-x-auto p-2 space-y-1">
            {#each blossomLogs as log}
              {@const time = new Date(log.timestamp).toLocaleTimeString()}
              <div class="flex items-center gap-2 whitespace-nowrap {log.success ? 'text-success' : 'text-danger'}">
                <span class="text-text-3">{time}</span>
                <span>{log.operation.toUpperCase()}</span>
                <span class="text-text-2">{log.server}</span>
                <span class="text-text-3">{log.hash.slice(0, 8)}...</span>
                {#if log.success && log.bytes}
                  <span class="text-text-3">{log.bytes}B</span>
                {:else if log.error}
                  <span>{log.error}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- WebRTC Pool Settings -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        WebRTC Pools
      </h3>
      <p class="text-xs text-text-3 mb-3">Max peer connections by category</p>
      <div class="bg-surface-2 rounded divide-y divide-surface-3">
        <!-- Follows pool -->
        <div class="p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-text-1">Follows</span>
            <span class="text-xs text-text-3">Peers you follow</span>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-text-3">Max</span>
              <input
                type="number"
                min="1"
                max="100"
                value={poolSettings.followsMax}
                onchange={(e) => settingsStore.setPoolSettings({ followsMax: parseInt(e.currentTarget.value) || 20 })}
                class="input text-sm"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-text-3">Satisfied</span>
              <input
                type="number"
                min="1"
                max="100"
                value={poolSettings.followsSatisfied}
                onchange={(e) => settingsStore.setPoolSettings({ followsSatisfied: parseInt(e.currentTarget.value) || 10 })}
                class="input text-sm"
              />
            </label>
          </div>
        </div>
        <!-- Others pool -->
        <div class="p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-text-1">Others</span>
            <span class="text-xs text-text-3">Other peers</span>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-text-3">Max</span>
              <input
                type="number"
                min="0"
                max="100"
                value={poolSettings.otherMax}
                onchange={(e) => settingsStore.setPoolSettings({ otherMax: parseInt(e.currentTarget.value) || 10 })}
                class="input text-sm"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs text-text-3">Satisfied</span>
              <input
                type="number"
                min="0"
                max="100"
                value={poolSettings.otherSatisfied}
                onchange={(e) => settingsStore.setPoolSettings({ otherSatisfied: parseInt(e.currentTarget.value) || 5 })}
                class="input text-sm"
              />
            </label>
          </div>
        </div>
      </div>
      <button onclick={() => settingsStore.resetPoolSettings()} class="btn-ghost mt-2 text-xs text-text-3">
        Reset to defaults
      </button>
    </div>

    <!-- Peers -->
    <div>
      <h3 class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        Peers ({peerList.length})
      </h3>
      <p class="text-xs text-text-3 mb-3">WebRTC connections for file exchange</p>

      <!-- Aggregate stats -->
      {#if webrtcStats && isLoggedIn}
        <div class="bg-surface-2 rounded p-3 mb-3">
          <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div class="flex justify-between">
              <span class="text-text-3">Reqs sent</span>
              <span class="text-text-1 font-mono">{webrtcStats.requestsSent}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-3">Reqs received</span>
              <span class="text-text-1 font-mono">{webrtcStats.requestsReceived}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-3">Res sent</span>
              <span class="text-text-1 font-mono">{webrtcStats.responsesSent}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-3">Res received</span>
              <span class="text-text-1 font-mono">{webrtcStats.responsesReceived}</span>
            </div>
            {#if webrtcStats.blossomFetches > 0}
              <div class="flex justify-between col-span-2">
                <span class="text-text-3">File server fetches</span>
                <span class="text-text-1 font-mono">{webrtcStats.blossomFetches}</span>
              </div>
            {/if}
            {#if webrtcStats.receiveErrors > 0}
              <div class="flex justify-between col-span-2">
                <span class="text-danger">Receive errors</span>
                <span class="text-danger font-mono">{webrtcStats.receiveErrors}</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}

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
            {@const peerStats = getPeerStats(peer.peerId)}
            <a
              href="#/{nip19.npubEncode(peer.pubkey)}"
              class="flex flex-col p-3 hover:bg-surface-3 transition-colors no-underline"
            >
              <div class="flex items-center gap-2 text-sm">
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
              </div>
              <!-- Per-peer stats -->
              {#if peerStats && peer.state === 'connected'}
                <div class="mt-2 ml-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-3">
                  <span title="Requests sent to this peer">
                    <span class="i-lucide-arrow-up-right inline-block align-middle mr-0.5"></span>{peerStats.requestsSent}
                  </span>
                  <span title="Requests received from this peer">
                    <span class="i-lucide-arrow-down-left inline-block align-middle mr-0.5"></span>{peerStats.requestsReceived}
                  </span>
                  <span title="Responses sent to this peer">
                    <span class="i-lucide-upload inline-block align-middle mr-0.5"></span>{peerStats.responsesSent}
                  </span>
                  <span title="Responses received from this peer">
                    <span class="i-lucide-download inline-block align-middle mr-0.5"></span>{peerStats.responsesReceived}
                  </span>
                  {#if peerStats.receiveErrors > 0}
                    <span title="Receive errors from this peer" class="text-danger">
                      <span class="i-lucide-alert-triangle inline-block align-middle mr-0.5"></span>{peerStats.receiveErrors}
                    </span>
                  {/if}
                </div>
              {/if}
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
      <p class="text-sm text-text-2 mb-3">
        hashtree - Content-addressed filesystem on Nostr
      </p>
      <div class="bg-surface-2 rounded p-3 text-sm space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-muted">Build</span>
          <span class="text-text-1 font-mono text-xs">
            {(() => {
              const buildTime = import.meta.env.VITE_BUILD_TIME;
              if (!buildTime || buildTime === 'undefined') return 'development';
              try {
                return new Date(buildTime).toLocaleString();
              } catch {
                return buildTime;
              }
            })()}
          </span>
        </div>
        <a
          href="#/npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk/hashtree-ts"
          class="btn-ghost w-full flex items-center justify-center gap-2 no-underline"
        >
          <span class="i-lucide-code text-sm"></span>
          <span>hashtree-ts</span>
          <span class="text-text-3 text-xs no-underline">(TypeScript library & this app)</span>
        </a>
        <a
          href="#/npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk/hashtree-rs"
          class="btn-ghost w-full flex items-center justify-center gap-2 no-underline"
        >
          <span class="i-lucide-terminal text-sm"></span>
          <span>hashtree-rs</span>
          <span class="text-text-3 text-xs no-underline">(Rust CLI & P2P daemon)</span>
        </a>
        <button
          onclick={() => window.location.reload()}
          class="btn-ghost w-full flex items-center justify-center gap-2"
        >
          <span class="i-lucide-refresh-cw text-sm"></span>
          <span>Refresh App</span>
        </button>
      </div>
    </div>
  </div>
</div>
