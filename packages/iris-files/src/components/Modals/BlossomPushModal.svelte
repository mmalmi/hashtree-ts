<script lang="ts" module>
  /**
   * BlossomPushModal - Push directory/file contents to Blossom servers
   */
  import type { CID } from 'hashtree';

  export interface BlossomPushTarget {
    cid: CID;
    name: string;
    isDirectory: boolean;
  }

  let show = $state(false);
  let target = $state<BlossomPushTarget | null>(null);

  export function open(cid: CID, name: string, isDirectory: boolean) {
    target = { cid, name, isDirectory };
    show = true;
  }

  export function close() {
    show = false;
    target = null;
  }
</script>

<script lang="ts">
  import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../../stores/settings';
  import { getTree } from '../../store';
  import { signEvent } from '../../nostr';
  import { toHex, BlossomStore } from 'hashtree';
  import type { BlossomSigner } from 'hashtree';

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

  // State
  let phase = $state<'select' | 'pushing' | 'done'>('select');
  let servers = $state<BlossomServerOption[]>([]);
  let results = $state<PushResult[]>([]);
  let currentFile = $state<string>('');
  let progress = $state({ current: 0, total: 0 });
  let abortController = $state<AbortController | null>(null);
  let wasCancelled = $state(false);

  // Initialize servers from settings when modal opens
  $effect(() => {
    if (!show) {
      // Reset state when modal closes
      phase = 'select';
      servers = [];
      results = [];
      currentFile = '';
      progress = { current: 0, total: 0 };
      abortController = null;
      wasCancelled = false;
      return;
    }

    // Get blossom servers from settings
    const settings = $settingsStore;
    const blossomServers = settings.network?.blossomServers?.length > 0
      ? settings.network.blossomServers
      : DEFAULT_NETWORK_SETTINGS.blossomServers;

    // Show all servers, pre-select write-enabled ones
    servers = blossomServers
      .map(s => ({ url: s.url, selected: s.write, write: s.write }));
  });

  // Handle Escape key
  $effect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'pushing') {
          abortController?.abort();
        } else {
          close();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // Create BlossomSigner adapter from nostr signEvent
  function createBlossomSigner(): BlossomSigner {
    return async (event) => {
      const signed = await signEvent({
        ...event,
        pubkey: '',
        id: '',
        sig: '',
      });
      return signed;
    };
  }

  async function startPush() {
    if (!target) return;

    const selectedServers = servers.filter(s => s.selected);
    if (selectedServers.length === 0) {
      alert('Please select at least one server');
      return;
    }

    phase = 'pushing';
    abortController = new AbortController();
    wasCancelled = false;
    results = [];

    // Create BlossomStore with only the selected servers
    const blossomStore = new BlossomStore({
      servers: selectedServers.map(s => ({ url: s.url, write: true })),
      signer: createBlossomSigner(),
    });

    const tree = getTree();

    // Use tree.push() which handles pull + walkBlocks + per-block uploads
    currentFile = 'Pushing...';

    const pushResult = await tree.push(target.cid, blossomStore, {
      signal: abortController.signal,
      onProgress: (current, total) => {
        progress = { current, total };
      },
      onBlock: (hash, status, error) => {
        const hexHash = toHex(hash);
        results = [...results, {
          hash: hexHash,
          name: hexHash.slice(0, 12) + '...',
          size: 0,
          status: status === 'error' ? 'error' : status === 'skipped' ? 'skipped' : 'success',
          error: error?.message,
        }];
        currentFile = hexHash.slice(0, 16) + '...';
      },
    });

    wasCancelled = pushResult.cancelled;
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
      if (e.target === e.currentTarget && phase !== 'pushing') close();
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
          Push to File Servers
        </h2>
        {#if phase !== 'pushing'}
          <button onclick={close} class="btn-ghost p-1" title="Close">
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
              <p class="text-sm text-text-3 italic">No file servers configured</p>
            {:else}
              <div class="space-y-2">
                {#each servers as server, i (server.url)}
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
            <button onclick={close} class="btn-ghost px-4 py-2">
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
              <span class="text-sm">Pushing chunks...</span>
            </div>

            <div class="bg-surface-2 rounded p-3">
              <div class="text-xs text-text-3 mb-1">
                {progress.current} / {progress.total} chunks
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
              onclick={() => abortController?.abort()}
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

            {#if wasCancelled}
              <div class="text-sm text-warning text-center">Push was cancelled</div>
            {/if}

            <!-- Error details -->
            {#if stats.errors > 0}
              <div class="bg-surface-2 rounded p-2 max-h-40 overflow-auto">
                <div class="text-xs text-text-3 mb-1">Errors:</div>
                {#each results.filter(r => r.status === 'error') as result (result.name)}
                  <div class="text-xs text-danger truncate" title={result.error}>
                    {result.name}: {result.error}
                  </div>
                {/each}
              </div>
            {/if}

            <button
              onclick={close}
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
