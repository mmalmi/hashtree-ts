<script lang="ts">
  /**
   * BlossomPushModal - Push directory/file contents to Blossom servers
   * Uses BlossomStore from hashtree for uploads with proper auth and backoff
   */
  import { modalsStore, closeBlossomPushModal } from '../../stores/modals';
  import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../../stores/settings';
  import { getTree } from '../../store';
  import { signEvent } from '../../nostr';
  import { LinkType, toHex, BlossomStore, cid as makeCid } from 'hashtree';
  import type { CID, BlossomSigner, Hash } from 'hashtree';

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

  // Recursively collect all blocks (hashes) in a merkle tree
  // Uses tree.getTreeNode() which handles encrypted nodes
  // Returns list of missing hashes if any blocks couldn't be fetched
  async function collectBlocks(
    id: CID,
    blocks: Map<string, { hash: Hash; data: Uint8Array }>,
    missing: string[] = []
  ): Promise<string[]> {
    const hex = toHex(id.hash);
    if (blocks.has(hex)) return missing; // Already collected

    const tree = getTree();
    const store = tree.getStore();
    // store.get() will try WebRTC peers if not local
    const data = await store.get(id.hash);
    if (!data) {
      missing.push(hex);
      return missing; // Can't traverse children if parent missing
    }

    blocks.set(hex, { hash: id.hash, data });

    // Use tree.getTreeNode() which handles encrypted nodes
    const node = await tree.getTreeNode(id);
    if (node) {
      for (const link of node.links) {
        // Build CID for child - link may have its own key
        const childCid = makeCid(link.hash, link.key);
        await collectBlocks(childCid, blocks, missing);
      }
    }
    return missing;
  }

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
    cancelled = false;
    results = [];

    // Create BlossomStore with only the selected servers
    const blossomStore = new BlossomStore({
      servers: selectedServers.map(s => ({ url: s.url, write: true })),
      signer: createBlossomSigner(),
    });

    // Collect all blocks in the merkle tree (handles encrypted nodes)
    currentFile = 'Collecting blocks...';
    const blocks = new Map<string, { hash: Hash; data: Uint8Array }>();
    const missingBlocks = await collectBlocks(target.cid, blocks);

    const blockList = Array.from(blocks.values());
    progress = { current: 0, total: blockList.length + missingBlocks.length };

    // Initialize results - include missing blocks as errors
    results = [
      ...blockList.map(b => ({
        hash: toHex(b.hash),
        name: toHex(b.hash).slice(0, 12) + '...', // Short hash as name
        size: b.data.length,
        status: 'pending' as const,
      })),
      ...missingBlocks.map(hex => ({
        hash: hex,
        name: hex.slice(0, 12) + '...',
        size: 0,
        status: 'error' as const,
        error: 'Block not found locally or from peers',
      })),
    ];

    // Push each block using BlossomStore
    for (let i = 0; i < blockList.length; i++) {
      if (cancelled) break;

      const block = blockList[i];
      const resultIdx = i;
      currentFile = toHex(block.hash).slice(0, 16) + '...';

      results[resultIdx] = { ...results[resultIdx], status: 'uploading' };

      // Use BlossomStore.put() - handles auth, hash verification, parallel uploads
      try {
        const isNew = await blossomStore.put(block.hash, block.data);
        results[resultIdx] = {
          ...results[resultIdx],
          status: isNew ? 'success' : 'skipped',
        };
      } catch (e) {
        results[resultIdx] = {
          ...results[resultIdx],
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
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
