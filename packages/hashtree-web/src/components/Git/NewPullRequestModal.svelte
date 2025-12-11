<script lang="ts">
  /**
   * Modal for creating a new pull request
   */
  import { modalsStore, closeNewPullRequestModal } from '../../stores';
  import { createPullRequest } from '../../nip34';

  let modalState = $derived($modalsStore);
  let isOpen = $derived(modalState.showNewPullRequestModal);
  let target = $derived(modalState.newPullRequestTarget);

  let title = $state('');
  let description = $state('');
  let branch = $state('');
  let targetBranch = $state('main');
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);

  function handleClose() {
    title = '';
    description = '';
    branch = '';
    targetBranch = 'main';
    error = null;
    closeNewPullRequestModal();
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!target || !title.trim()) return;

    isSubmitting = true;
    error = null;

    try {
      const pr = await createPullRequest(target.npub, target.repoName, title.trim(), description.trim(), {
        branch: branch.trim() || undefined,
        targetBranch: targetBranch.trim() || 'main',
      });

      if (pr) {
        target.onCreate?.({ id: pr.id, title: pr.title });
        handleClose();
        // Navigate to the new PR
        window.location.hash = `/${target.npub}/${target.repoName}/pulls/${pr.id}`;
      } else {
        error = 'Failed to create pull request';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create pull request';
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }
</script>

{#if isOpen && target}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    onclick={(e) => e.target === e.currentTarget && handleClose()}
    onkeydown={handleKeyDown}
  >
    <div class="bg-surface-0 rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 b-b-1 b-b-solid b-b-surface-3">
        <h2 class="text-lg font-semibold">New Pull Request</h2>
        <button onclick={handleClose} class="btn-ghost p-1">
          <span class="i-lucide-x text-lg"></span>
        </button>
      </div>

      <!-- Form -->
      <form onsubmit={handleSubmit} class="p-4 flex flex-col gap-4">
        {#if error}
          <div class="px-3 py-2 bg-danger/10 text-danger rounded-md text-sm">
            {error}
          </div>
        {/if}

        <div class="flex flex-col gap-1.5">
          <label for="pr-title" class="text-sm font-medium">Title</label>
          <input
            id="pr-title"
            type="text"
            bind:value={title}
            placeholder="Brief description of changes"
            class="px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent"
            required
          />
        </div>

        <div class="flex gap-3">
          <div class="flex-1 flex flex-col gap-1.5">
            <label for="pr-branch" class="text-sm font-medium">Source Branch</label>
            <input
              id="pr-branch"
              type="text"
              bind:value={branch}
              placeholder="feature/..."
              class="px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent"
            />
          </div>
          <div class="flex items-center pt-6">
            <span class="i-lucide-arrow-right text-text-3"></span>
          </div>
          <div class="flex-1 flex flex-col gap-1.5">
            <label for="pr-target" class="text-sm font-medium">Target Branch</label>
            <input
              id="pr-target"
              type="text"
              bind:value={targetBranch}
              placeholder="main"
              class="px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="pr-description" class="text-sm font-medium">Description</label>
          <textarea
            id="pr-description"
            bind:value={description}
            placeholder="Detailed explanation of the changes (markdown supported)"
            rows="6"
            class="px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent resize-y"
          ></textarea>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick={handleClose} class="btn-ghost px-4 py-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || isSubmitting}
            class="btn-primary px-4 py-2 flex items-center gap-2"
          >
            {#if isSubmitting}
              <span class="i-lucide-loader-2 animate-spin"></span>
            {:else}
              <span class="i-lucide-git-pull-request"></span>
            {/if}
            Create Pull Request
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
