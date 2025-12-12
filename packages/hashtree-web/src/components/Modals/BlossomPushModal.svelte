<script lang="ts">
  /**
   * BlossomPushModal - Push directory/file contents to Blossom servers
   */
  import { modalsStore, closeBlossomPushModal } from '../../stores/modals';
  import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../../stores/settings';
  import { getTree } from '../../store';
  import { signEvent } from '../../nostr';
  import { LinkType, toHex, sha256 } from 'hashtree';
  import type { CID, Hash } from 'hashtree';

  interface PushResult {
    hash: string;
    name: string;
    size: number;
    status: 'pending' | 'uploading' | 'success' | 'skipped' | 'error';
    error?: string;
  }

  interface BlossomServerOption {
    url: string;
    selected: boolean;
    write: boolean;
  }

  let show = $derived($modalsStore.showBlossomPushModal);
  let target = $derived($modalsStore.blossomPushTarget);

  // State
  let phase = $state<'select' | 'pushing' | 'done'>('select');
  let servers = $state<BlossomServerOption[]>([]);
  let results = $state<PushResult[]>([]);
  let currentFile = $state<string>('');
  let progress = $state({ current: 0, total: 0 });
  let cancelled = $state(false);

  // Initialize servers from settings when modal opens
  $effect(() => {
    if (!show) {
      // Reset state when modal closes
      phase = 'select';
      servers = [];
      results = [];
      currentFile = '';
      progress = { current: 0, total: 0 };
      cancelled = false;
      return;
    }

    // Get blossom servers from settings
    const settings = $settingsStore;
    const blossomServers = settings.network?.blossomServers?.length > 0
      ? settings.network.blossomServers
      : DEFAULT_NETWORK_SETTINGS.blossomServers;

    // Only show write-enabled servers
    servers = blossomServers
      .filter(s => s.write)
      .map(s => ({ url: s.url, selected: true, write: s.write }));
  });

  // Handle Escape key
  $effect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'pushing') {
          cancelled = true;
        } else {
          closeBlossomPushModal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // Recursively collect all files from a directory
  async function collectFiles(
    cid: CID,
    basePath: string,
    files: Array<{ cid: CID; path: string; size: number }>
  ): Promise<void> {
    const tree = getTree();
    const entries = await tree.listDirectory(cid);

    for (const entry of entries) {
      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.type === LinkType.Dir) {
        await collectFiles(entry.cid, fullPath, files);
      } else {
        files.push({ cid: entry.cid, path: fullPath, size: entry.size });
      }
    }
  }

  // Create auth header for Blossom upload
  async function createAuthHeader(hash: Hash): Promise<string> {
    const hashHex = toHex(hash);
    const expiration = Math.floor(Date.now() / 1000) + 300; // 5 min

    const tags: string[][] = [
      ['t', 'upload'],
      ['x', hashHex],
      ['expiration', expiration.toString()],
    ];

    const event = await signEvent({
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      content: `upload ${hashHex}`,
      tags,
      pubkey: '', // Will be filled by signEvent
      id: '',
      sig: '',
    });

    return `Nostr ${btoa(JSON.stringify(event))}`;
  }

  // Push a single file to a server
  async function pushFile(
    data: Uint8Array,
    hash: Hash,
    serverUrl: string
  ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    try {
      const authHeader = await createAuthHeader(hash);
      const hashHex = toHex(hash);

      const response = await fetch(`${serverUrl}/upload`, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/octet-stream',
          'X-SHA-256': hashHex,
        },
        body: new Blob([data.buffer as ArrayBuffer]),
      });

      if (response.status === 409) {
        // Already exists
        return { success: true, skipped: true };
      }

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `${response.status}: ${text}` };
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function startPush() {
    if (!target) return;

    const selectedServers = servers.filter(s => s.selected);
    if (selectedServers.length === 0) {
      alert('Please select at least one server');
      return;
    }

    phase = 'pushing';
    cancelled = false;
    results = [];
    const tree = getTree();

    // Collect files
    const files: Array<{ cid: CID; path: string; size: number }> = [];

    if (target.isDirectory) {
      currentFile = 'Collecting files...';
      await collectFiles(target.cid, '', files);
    } else {
      // Single file
      files.push({ cid: target.cid, path: target.name, size: 0 });
    }

    progress = { current: 0, total: files.length };

    // Initialize results
    results = files.map(f => ({
      hash: toHex(f.cid.hash),
      name: f.path,
      size: f.size,
      status: 'pending',
    }));

    // Push each file
    for (let i = 0; i < files.length; i++) {
      if (cancelled) break;

      const file = files[i];
      const resultIdx = i;
      currentFile = file.path;

      results[resultIdx] = { ...results[resultIdx], status: 'uploading' };

      // Read file data
      const data = await tree.readFile(file.cid);
      if (!data) {
        results[resultIdx] = { ...results[resultIdx], status: 'error', error: 'Failed to read file' };
        progress = { ...progress, current: i + 1 };
        continue;
      }

      // Verify hash
      const computed = await sha256(data);
      if (toHex(computed) !== toHex(file.cid.hash)) {
        results[resultIdx] = { ...results[resultIdx], status: 'error', error: 'Hash mismatch' };
        progress = { ...progress, current: i + 1 };
        continue;
      }

      // Push to each selected server
      let anySuccess = false;
      let anySkipped = false;
      let lastError = '';

      for (const server of selectedServers) {
        if (cancelled) break;
        const result = await pushFile(data, file.cid.hash, server.url);
        if (result.success) {
          anySuccess = true;
          if (result.skipped) anySkipped = true;
        } else if (result.error) {
          lastError = result.error;
        }
      }

      if (anySuccess) {
        results[resultIdx] = {
          ...results[resultIdx],
          status: anySkipped ? 'skipped' : 'success',
          size: data.length,
        };
      } else {
        results[resultIdx] = {
          ...results[resultIdx],
          status: 'error',
          error: lastError || 'Unknown error',
        };
      }

      progress = { ...progress, current: i + 1 };
    }

    phase = 'done';
    currentFile = '';
  }

  // Stats for display
  let stats = $derived.by(() => {
    const success = results.filter(r => r.status === 'success').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;
    const totalBytes = results
      .filter(r => r.status === 'success' || r.status === 'skipped')
      .reduce((acc, r) => acc + (r.size || 0), 0);
    return { success, skipped, errors, totalBytes };
  });

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

{#if show && target}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/70 flex-center z-1000 overflow-auto"
    onclick={(e) => {
      if (e.target === e.currentTarget && phase !== 'pushing') closeBlossomPushModal();
    }}
    data-modal-backdrop
    data-testid="blossom-push-modal-backdrop"
  >
    <div
      class="bg-surface-1 sm:rounded-lg overflow-hidden w-screen sm:w-[32rem] sm:max-w-[90vw] sm:border border-surface-3 max-h-[90vh] flex flex-col"
      data-testid="blossom-push-modal"
    >
      <!-- Header -->
      <div class="p-4 border-b border-surface-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <span class="i-lucide-upload-cloud"></span>
          Push to Blossom
        </h2>
        {#if phase !== 'pushing'}
          <button onclick={closeBlossomPushModal} class="btn-ghost p-1">
            <span class="i-lucide-x"></span>
          </button>
        {/if}
      </div>

      <!-- Content -->
      <div class="p-4 overflow-auto flex-1">
        {#if phase === 'select'}
          <!-- Server selection -->
          <div class="mb-4">
            <p class="text-sm text-text-3 mb-2">
              Push <span class="text-text-1 font-medium">{target.name}</span>
              {target.isDirectory ? ' (directory)' : ''} to:
            </p>

            {#if servers.length === 0}
              <p class="text-sm text-text-3 italic">No write-enabled Blossom servers configured</p>
            {:else}
              <div class="space-y-2">
                {#each servers as server, i}
                  <label class="flex items-center gap-2 p-2 rounded bg-surface-2 cursor-pointer hover:bg-surface-3">
                    <input
                      type="checkbox"
                      bind:checked={servers[i].selected}
                      class="accent-accent"
                    />
                    <span class="i-lucide-server text-text-3"></span>
                    <span class="text-sm">{new URL(server.url).hostname}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="flex justify-end gap-2">
            <button onclick={closeBlossomPushModal} class="btn-ghost px-4 py-2">
              Cancel
            </button>
            <button
              onclick={startPush}
              disabled={servers.filter(s => s.selected).length === 0}
              class="btn-primary px-4 py-2 flex items-center gap-2"
              data-testid="start-push-btn"
            >
              <span class="i-lucide-upload"></span>
              Push
            </button>
          </div>

        {:else if phase === 'pushing'}
          <!-- Progress -->
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <span class="i-lucide-loader-2 animate-spin text-accent"></span>
              <span class="text-sm">Pushing files...</span>
            </div>

            <div class="bg-surface-2 rounded p-3">
              <div class="text-xs text-text-3 mb-1">
                {progress.current} / {progress.total} files
              </div>
              <div class="h-2 bg-surface-3 rounded-full overflow-hidden">
                <div
                  class="h-full bg-accent transition-all"
                  style="width: {progress.total > 0 ? (progress.current / progress.total * 100) : 0}%"
                ></div>
              </div>
              <div class="text-xs text-text-3 mt-1 truncate">
                {currentFile}
              </div>
            </div>

            <button
              onclick={() => { cancelled = true; }}
              class="btn-ghost text-danger w-full py-2"
            >
              Cancel
            </button>
          </div>

        {:else}
          <!-- Results -->
          <div class="space-y-4">
            <!-- Summary -->
            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="bg-surface-2 rounded p-2">
                <div class="text-lg font-semibold text-success">{stats.success}</div>
                <div class="text-xs text-text-3">Uploaded</div>
              </div>
              <div class="bg-surface-2 rounded p-2">
                <div class="text-lg font-semibold text-text-3">{stats.skipped}</div>
                <div class="text-xs text-text-3">Already exist</div>
              </div>
              <div class="bg-surface-2 rounded p-2">
                <div class="text-lg font-semibold text-danger">{stats.errors}</div>
                <div class="text-xs text-text-3">Failed</div>
              </div>
            </div>

            <div class="text-sm text-text-3 text-center">
              {formatBytes(stats.totalBytes)} total
            </div>

            {#if cancelled}
              <div class="text-sm text-warning text-center">Push was cancelled</div>
            {/if}

            <!-- Error details -->
            {#if stats.errors > 0}
              <div class="bg-surface-2 rounded p-2 max-h-40 overflow-auto">
                <div class="text-xs text-text-3 mb-1">Errors:</div>
                {#each results.filter(r => r.status === 'error') as result}
                  <div class="text-xs text-danger truncate" title={result.error}>
                    {result.name}: {result.error}
                  </div>
                {/each}
              </div>
            {/if}

            <button
              onclick={closeBlossomPushModal}
              class="btn-primary w-full py-2"
            >
              Done
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
