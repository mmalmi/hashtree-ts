<script lang="ts">
  /**
   * BranchDropdown - Git branch selector with new branch creation
   */
  import type { CID } from 'hashtree';
  import { createBranch } from '../../utils/git';
  import Dropdown from '../ui/Dropdown.svelte';

  interface Props {
    branches: string[];
    currentBranch: string | null;
    branchDisplay: string;
    canEdit: boolean;
    dirCid: CID;
    onBranchSelect?: (branch: string) => void;
  }

  let { branches, currentBranch, branchDisplay, canEdit, dirCid, onBranchSelect }: Props = $props();

  // Branch dropdown state
  let isDropdownOpen = $state(false);
  let showNewBranchInput = $state(false);
  let newBranchName = $state('');
  let isCreatingBranch = $state(false);
  let branchError = $state<string | null>(null);

  function handleBranchSelect(branch: string) {
    if (onBranchSelect) {
      onBranchSelect(branch);
    }
    isDropdownOpen = false;
  }

  // Handle new branch creation
  async function handleCreateBranch() {
    if (!newBranchName.trim() || isCreatingBranch) return;

    isCreatingBranch = true;
    branchError = null;

    try {
      const result = await createBranch(dirCid, newBranchName.trim(), false);
      if (!result.success) {
        branchError = result.error || 'Failed to create branch';
        return;
      }
      // Success - close dropdown and reset
      showNewBranchInput = false;
      newBranchName = '';
      isDropdownOpen = false;
    } catch (err) {
      branchError = err instanceof Error ? err.message : String(err);
    } finally {
      isCreatingBranch = false;
    }
  }

  function handleClose() {
    isDropdownOpen = false;
    showNewBranchInput = false;
    branchError = null;
  }
</script>

<Dropdown bind:open={isDropdownOpen} onClose={handleClose}>
  {#snippet trigger()}
    <button
      onclick={() => isDropdownOpen = !isDropdownOpen}
      class="btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
    >
      <span class="i-lucide-git-branch"></span>
      <span class={currentBranch ? '' : 'font-mono text-xs'}>{branchDisplay}</span>
      <span class="i-lucide-chevron-down text-xs"></span>
    </button>
  {/snippet}
  <!-- Branch list -->
  {#each branches as branch}
    <button
      onclick={() => handleBranchSelect(branch)}
      class="w-full text-left px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-3 flex items-center gap-2 text-text-1 b-0"
    >
      {#if branch === currentBranch}
        <span class="i-lucide-check text-accent text-xs"></span>
      {:else}
        <span class="ml-4"></span>
      {/if}
      <span>{branch}</span>
    </button>
  {/each}
  <!-- New branch option (only for editors) -->
  {#if canEdit}
    <div class="b-t-1 b-t-solid b-t-surface-3 mt-1 pt-1">
      {#if showNewBranchInput}
        <div class="px-3 py-2">
          {#if branchError}
            <div class="text-xs text-error mb-2">{branchError}</div>
          {/if}
          <input
            type="text"
            bind:value={newBranchName}
            placeholder="Branch name"
            class="w-full px-2 py-1 text-sm bg-surface-0 b-1 b-solid b-surface-3 rounded focus:outline-none focus:b-accent"
            onkeydown={(e) => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') { showNewBranchInput = false; branchError = null; } }}
          />
          <div class="flex gap-2 mt-2">
            <button
              onclick={handleCreateBranch}
              disabled={isCreatingBranch || !newBranchName.trim()}
              class="btn-primary text-xs px-2 py-1 flex items-center gap-1"
            >
              {#if isCreatingBranch}
                <span class="i-lucide-loader-2 animate-spin"></span>
              {:else}
                <span class="i-lucide-plus"></span>
              {/if}
              Create
            </button>
            <button
              onclick={() => { showNewBranchInput = false; branchError = null; }}
              class="btn-ghost text-xs px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <button
          onclick={() => { showNewBranchInput = true; newBranchName = ''; }}
          class="w-full text-left px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-3 flex items-center gap-2 text-text-1 b-0"
        >
          <span class="i-lucide-git-branch-plus text-xs"></span>
          <span>New branch</span>
        </button>
      {/if}
    </div>
  {/if}
</Dropdown>
