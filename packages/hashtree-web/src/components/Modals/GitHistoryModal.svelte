<script lang="ts">
  /**
   * Modal for displaying git commit history
   */
  import { modalsStore, closeGitHistoryModal } from '../../stores/modals';
  import { createGitLogStore, type CommitInfo } from '../../stores/git';
  import { nhashEncode } from 'hashtree';
  import { bytesToHex } from '@noble/hashes/utils.js';
  import { checkoutCommit } from '../../utils/git';

  let show = $derived($modalsStore.showGitHistoryModal);
  let target = $derived($modalsStore.gitHistoryTarget);

  // Create git log store when modal opens
  let logStore = $derived(target ? createGitLogStore(target.dirCid, 100) : null);
  let logState = $state<{ commits: CommitInfo[]; headOid: string | null; loading: boolean; error: string | null }>({
    commits: [],
    headOid: null,
    loading: true,
    error: null,
  });

  let checkoutInProgress = $state<string | null>(null);
  let checkoutError = $state<string | null>(null);

  $effect(() => {
    if (!logStore) {
      logState = { commits: [], headOid: null, loading: false, error: null };
      return;
    }
    const unsub = logStore.subscribe(value => {
      logState = value;
    });
    return unsub;
  });

  // Handle ESC key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGitHistoryModal();
    }
  }

  $effect(() => {
    if (show) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  });

  // Format timestamp
  function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const mins = Math.floor(diff / (1000 * 60));
        return mins <= 1 ? 'just now' : `${mins} minutes ago`;
      }
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  }

  // Get first line of commit message
  function getCommitTitle(message: string): string {
    return message.split('\n')[0].slice(0, 72);
  }

  // Get short commit hash
  function shortHash(oid: string): string {
    return oid.slice(0, 7);
  }

  // Handle checkout button click (for own repos)
  async function handleCheckout(commitSha: string) {
    if (!target || checkoutInProgress) return;

    checkoutInProgress = commitSha;
    checkoutError = null;

    try {
      if (target.onCheckout) {
        await target.onCheckout(commitSha);
        closeGitHistoryModal();
      }
    } catch (err) {
      checkoutError = err instanceof Error ? err.message : String(err);
    } finally {
      checkoutInProgress = null;
    }
  }

  // Handle browse button click (for others' repos)
  async function handleBrowse(commitSha: string) {
    if (!target) return;

    try {
      // Checkout to get the CID at that commit
      const newCid = await checkoutCommit(target.dirCid, commitSha);

      // Convert CID to nhash
      const hashHex = bytesToHex(newCid.hash);
      const keyHex = newCid.key ? bytesToHex(newCid.key) : undefined;
      const nhash = nhashEncode({ hash: hashHex, decryptKey: keyHex });

      // Open in new tab
      window.open(`#/${nhash}`, '_blank');
    } catch (err) {
      checkoutError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if show && target}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={closeGitHistoryModal}>
    <div class="bg-surface-1 rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="flex items-center justify-between p-4 b-b-1 b-b-solid b-b-surface-3">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <span class="i-lucide-history"></span>
          Commit History
        </h2>
        <button onclick={closeGitHistoryModal} class="btn-ghost p-1">
          <span class="i-lucide-x text-lg"></span>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto p-4">
        {#if logState.loading}
          <div class="flex items-center justify-center py-8 text-text-3">
            <span class="i-lucide-loader-2 animate-spin mr-2"></span>
            Loading commits...
          </div>
        {:else if logState.error}
          <div class="flex items-center justify-center py-8 text-error">
            <span class="i-lucide-alert-circle mr-2"></span>
            {logState.error}
          </div>
        {:else if logState.commits.length === 0}
          <div class="flex items-center justify-center py-8 text-text-3">
            No commits found
          </div>
        {:else}
          {#if checkoutError}
            <div class="mb-4 p-3 bg-error/10 text-error rounded-lg text-sm flex items-center gap-2">
              <span class="i-lucide-alert-circle"></span>
              {checkoutError}
            </div>
          {/if}
          <div class="flex flex-col">
            {#each logState.commits as commit, i}
              {@const isHead = commit.oid === logState.headOid}
              <div class="flex gap-3 pb-4 {i < logState.commits.length - 1 ? 'b-b-1 b-b-solid b-b-surface-3 mb-4' : ''} {isHead ? 'bg-accent/5 -mx-4 px-4 py-3 rounded-lg' : ''}">
                <!-- Timeline dot -->
                <div class="flex flex-col items-center shrink-0">
                  <div class="w-3 h-3 rounded-full {isHead ? 'bg-success ring-2 ring-success/30' : 'bg-accent'}"></div>
                  {#if i < logState.commits.length - 1}
                    <div class="w-0.5 flex-1 bg-surface-3 mt-1"></div>
                  {/if}
                </div>

                <!-- Commit info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-medium text-text-1 truncate" title={commit.message}>
                      {getCommitTitle(commit.message)}
                    </span>
                    {#if isHead}
                      <span class="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-success/20 text-success flex items-center gap-1">
                        <span class="i-lucide-circle-dot text-[10px]"></span>
                        HEAD
                      </span>
                    {/if}
                  </div>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-3">
                    <span class="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-xs">
                      {shortHash(commit.oid)}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="i-lucide-user text-xs"></span>
                      {commit.author}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="i-lucide-clock text-xs"></span>
                      {formatDate(commit.timestamp)}
                    </span>
                  </div>
                </div>

                <!-- Action button -->
                <div class="shrink-0">
                  {#if target.canEdit && target.onCheckout}
                    {#if isHead}
                      <span class="text-xs text-text-3 px-2 py-1">Current</span>
                    {:else}
                      <button
                        onclick={() => handleCheckout(commit.oid)}
                        disabled={checkoutInProgress !== null}
                        class="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
                        title="Checkout this commit (replaces working directory)"
                      >
                        {#if checkoutInProgress === commit.oid}
                          <span class="i-lucide-loader-2 animate-spin"></span>
                        {:else}
                          <span class="i-lucide-git-branch-plus"></span>
                        {/if}
                        Checkout
                      </button>
                    {/if}
                  {:else}
                    <button
                      onclick={() => handleBrowse(commit.oid)}
                      class="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
                      title="Browse files at this commit"
                    >
                      <span class="i-lucide-external-link"></span>
                      Browse
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-between items-center p-4 b-t-1 b-t-solid b-t-surface-3">
        <span class="text-sm text-text-3">
          {logState.commits.length} commit{logState.commits.length !== 1 ? 's' : ''}
        </span>
        <button onclick={closeGitHistoryModal} class="btn-ghost">Close</button>
      </div>
    </div>
  </div>
{/if}
