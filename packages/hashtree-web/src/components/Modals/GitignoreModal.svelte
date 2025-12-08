<script lang="ts">
  /**
   * Modal for handling .gitignore detection in directory uploads
   */
  import { modalsStore, closeGitignoreModal } from '../../hooks/useModals';
  import { formatBytes } from '../../store';

  let show = $derived($modalsStore.showGitignoreModal);
  let target = $derived($modalsStore.gitignoreTarget);

  let rememberChoice = $state(false);

  // Calculate excluded size
  let excludedSize = $derived(
    target ? target.excludedFiles.reduce((sum, f) => sum + f.file.size, 0) : 0
  );

  function handleUseGitignore() {
    target?.onDecision(true, rememberChoice);
    closeGitignoreModal();
  }

  function handleUploadAll() {
    target?.onDecision(false, rememberChoice);
    closeGitignoreModal();
  }

  function handleClose() {
    target?.onDecision(false, false);
    closeGitignoreModal();
  }
</script>

{#if show && target}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={handleClose}>
    <div class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">.gitignore Detected</h2>

      <div class="mb-4">
        <p class="text-text-2 mb-3">
          Found <strong>.gitignore</strong> in <strong>{target.dirName}</strong>.
          Skip {target.excludedFiles.length} ignored file{target.excludedFiles.length !== 1 ? 's' : ''} ({formatBytes(excludedSize)})?
        </p>

        <!-- Show some excluded files -->
        {#if target.excludedFiles.length > 0}
          <div class="mb-3">
            <div class="text-sm text-text-3 mb-1">Files to skip:</div>
            <div class="max-h-30 overflow-y-auto bg-surface-2 rounded p-2 text-sm">
              {#each target.excludedFiles.slice(0, 15) as f}
                <div class="flex justify-between py-0.5 text-text-3">
                  <span class="truncate flex-1 mr-2">{f.relativePath}</span>
                  <span>{formatBytes(f.file.size)}</span>
                </div>
              {/each}
              {#if target.excludedFiles.length > 15}
                <div class="text-text-3 py-1">...and {target.excludedFiles.length - 15} more</div>
              {/if}
            </div>
          </div>
        {/if}

        <div class="flex items-center gap-2 text-sm text-text-2 bg-surface-2 rounded p-2">
          <span class="i-lucide-info text-accent"></span>
          <span>
            Will upload {target.includedFiles.length} of {target.allFiles.length} files
          </span>
        </div>
      </div>

      <!-- Remember choice checkbox -->
      <label class="flex items-center gap-2 mb-4 cursor-pointer text-sm text-text-2">
        <input
          type="checkbox"
          bind:checked={rememberChoice}
          class="w-4 h-4 accent-accent"
        />
        <span>Remember my choice</span>
      </label>

      <div class="flex gap-2">
        <button onclick={handleUploadAll} class="btn-ghost">
          Upload All
        </button>
        <button onclick={handleUseGitignore} class="btn-success">
          <span class="i-lucide-filter mr-1"></span>
          Skip Ignored
        </button>
      </div>
    </div>
  </div>
{/if}
