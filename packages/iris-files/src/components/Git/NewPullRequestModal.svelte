<script lang="ts">
  /**
   * Modal for creating a new pull request
   * Supports:
   * - Branch selection via dropdowns when branches are available
   * - Cross-repo PRs with source repo specification (npub/path or nhash)
   */
  import { modalsStore, closeNewPullRequestModal } from '../../stores';
  import { createPullRequest } from '../../nip34';

  let modalState = $derived($modalsStore);
  let isOpen = $derived(modalState.showNewPullRequestModal);
  let target = $derived(modalState.newPullRequestTarget);

  // Available branches from the target (destination) repo
  let branches = $derived(target?.branches || []);
  let defaultBranch = $derived(branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : branches[0] || 'main');

  let title = $state('');
  let description = $state('');

  // Source (head) - where the changes come from
  let sourceBranch = $state('');
  let sourceRepo = $state(''); // Optional: npub/path or nhash for cross-repo PRs
  let showSourceRepo = $state(false);

  // Target (base) - where to merge into
  let targetBranch = $state('');

  let isSubmitting = $state(false);
  let error = $state<string | null>(null);

  // Dropdown open states
  let sourceBranchDropdownOpen = $state(false);
  let targetBranchDropdownOpen = $state(false);

  // Initialize when modal opens
  $effect(() => {
    if (isOpen && target) {
      // Pre-select current branch as source if it's not the default
      if (target.currentBranch && target.currentBranch !== defaultBranch) {
        sourceBranch = target.currentBranch;
      } else if (branches.length > 1) {
        // Find first branch that isn't the default
        const nonDefault = branches.find(b => b !== defaultBranch);
        sourceBranch = nonDefault || '';
      }
      targetBranch = defaultBranch;
      sourceRepo = '';
      showSourceRepo = false;
    }
  });

  function handleClose() {
    title = '';
    description = '';
    sourceBranch = '';
    sourceRepo = '';
    showSourceRepo = false;
    targetBranch = '';
    error = null;
    closeNewPullRequestModal();
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!target || !title.trim()) return;

    // Validate branch selection
    if (!sourceBranch.trim()) {
      error = 'Please select or enter a source branch';
      return;
    }

    isSubmitting = true;
    error = null;

    try {
      const pr = await createPullRequest(target.npub, target.repoName, title.trim(), description.trim(), {
        branch: sourceBranch.trim(),
        targetBranch: targetBranch.trim() || 'main',
        // Include source repo info in clone URL if specified
        cloneUrl: sourceRepo.trim() || undefined,
      });

      if (pr) {
        target.onCreate?.({ id: pr.id, title: pr.title });
        handleClose();
        // Navigate to the new PR using query params
        window.location.hash = `/${target.npub}/${target.repoName}?tab=pulls&id=${pr.id}`;
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

  function selectSourceBranch(branch: string) {
    sourceBranch = branch;
    sourceBranchDropdownOpen = false;
  }

  function selectTargetBranch(branch: string) {
    targetBranch = branch;
    targetBranchDropdownOpen = false;
  }
</script>

{#if isOpen && target}
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

        <!-- Title -->
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

        <!-- Branch selection -->
        <div class="flex flex-col gap-3">
          <div class="text-sm font-medium">Branches</div>

          <div class="flex items-center gap-2">
            <!-- Source (head) branch -->
            <div class="flex-1">
              <div class="text-xs text-text-3 mb-1">From (source)</div>
              {#if branches.length > 0}
                <div class="relative">
                  <button
                    type="button"
                    onclick={() => sourceBranchDropdownOpen = !sourceBranchDropdownOpen}
                    class="w-full px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md text-left flex items-center justify-between text-sm"
                  >
                    <span class="flex items-center gap-2">
                      <span class="i-lucide-git-branch text-accent"></span>
                      <span class="font-mono">{sourceBranch || 'Select branch'}</span>
                    </span>
                    <span class="i-lucide-chevron-down text-text-3"></span>
                  </button>
                  {#if sourceBranchDropdownOpen}
                    <div class="absolute top-full left-0 right-0 mt-1 bg-surface-1 b-1 b-solid b-surface-3 rounded-md shadow-lg z-10 max-h-48 overflow-auto">
                      {#each branches as branch (branch)}
                        <button
                          type="button"
                          onclick={() => selectSourceBranch(branch)}
                          class="w-full px-3 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2 b-0 bg-transparent cursor-pointer"
                        >
                          {#if branch === sourceBranch}
                            <span class="i-lucide-check text-accent"></span>
                          {:else}
                            <span class="w-4"></span>
                          {/if}
                          <span class="font-mono">{branch}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <input
                  type="text"
                  bind:value={sourceBranch}
                  placeholder="feature/..."
                  class="w-full px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent text-sm font-mono"
                />
              {/if}
            </div>

            <!-- Arrow -->
            <div class="pt-5">
              <span class="i-lucide-arrow-right text-text-3"></span>
            </div>

            <!-- Target (base) branch -->
            <div class="flex-1">
              <div class="text-xs text-text-3 mb-1">Into (target)</div>
              {#if branches.length > 0}
                <div class="relative">
                  <button
                    type="button"
                    onclick={() => targetBranchDropdownOpen = !targetBranchDropdownOpen}
                    class="w-full px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md text-left flex items-center justify-between text-sm"
                  >
                    <span class="flex items-center gap-2">
                      <span class="i-lucide-git-branch"></span>
                      <span class="font-mono">{targetBranch || 'Select branch'}</span>
                    </span>
                    <span class="i-lucide-chevron-down text-text-3"></span>
                  </button>
                  {#if targetBranchDropdownOpen}
                    <div class="absolute top-full left-0 right-0 mt-1 bg-surface-1 b-1 b-solid b-surface-3 rounded-md shadow-lg z-10 max-h-48 overflow-auto">
                      {#each branches as branch (branch)}
                        <button
                          type="button"
                          onclick={() => selectTargetBranch(branch)}
                          class="w-full px-3 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2 b-0 bg-transparent cursor-pointer"
                        >
                          {#if branch === targetBranch}
                            <span class="i-lucide-check text-accent"></span>
                          {:else}
                            <span class="w-4"></span>
                          {/if}
                          <span class="font-mono">{branch}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <input
                  type="text"
                  bind:value={targetBranch}
                  placeholder="main"
                  class="w-full px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent text-sm font-mono"
                />
              {/if}
            </div>
          </div>

          <!-- Cross-repo toggle -->
          <button
            type="button"
            onclick={() => showSourceRepo = !showSourceRepo}
            class="text-xs text-text-3 hover:text-accent flex items-center gap-1 self-start b-0 bg-transparent cursor-pointer"
          >
            <span class={showSourceRepo ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'}></span>
            {showSourceRepo ? 'Hide' : 'From different repository (fork)'}
          </button>

          <!-- Source repo input (for cross-repo PRs) -->
          {#if showSourceRepo}
            <div class="flex flex-col gap-1.5 pl-4 b-l-2 b-l-solid b-l-surface-3">
              <label for="pr-source-repo" class="text-xs text-text-3">Source Repository</label>
              <input
                id="pr-source-repo"
                type="text"
                bind:value={sourceRepo}
                placeholder="npub.../repo or nhash..."
                class="px-3 py-2 bg-surface-1 b-1 b-solid b-surface-3 rounded-md focus:outline-none focus:b-accent text-sm font-mono"
              />
              <p class="text-xs text-text-3">
                Enter the repository containing your changes (npub/tree/path or nhash permalink)
              </p>
            </div>
          {/if}
        </div>

        <!-- Description -->
        <div class="flex flex-col gap-1.5">
          <label for="pr-description" class="text-sm font-medium">Description</label>
          <textarea
            id="pr-description"
            bind:value={description}
            placeholder="Detailed explanation of the changes (markdown supported)"
            rows="4"
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
            disabled={!title.trim() || !sourceBranch.trim() || isSubmitting}
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
