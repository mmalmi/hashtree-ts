<script lang="ts">
  /**
   * GitRepoView - GitHub-style directory listing with README below
   * Shows branch info, file list table, then README.md in its own panel
   */
  import { LinkType, type CID, type TreeEntry } from 'hashtree';
  import { getTree, decodeAsText, formatBytes } from '../../store';
  import { routeStore, createGitLogStore, createGitStatusStore, openGitHistoryModal, openGitShellModal, openGitCommitModal } from '../../stores';
  import { getFileLastCommits, createBranch } from '../../utils/git';
  import FolderActions from '../FolderActions.svelte';
  import ReadmePanel from '../Viewer/ReadmePanel.svelte';
  import Dropdown from '../ui/Dropdown.svelte';
  import RepoTabNav from './RepoTabNav.svelte';
  import type { GitStatusResult } from '../../utils/wasmGit';

  interface Props {
    dirCid: CID;
    entries: TreeEntry[];
    canEdit: boolean;
    currentBranch: string | null;
    branches: string[];
  }

  let { dirCid, entries, canEdit, currentBranch, branches }: Props = $props();

  let route = $derived($routeStore);
  let currentPath = $derived(route.path);

  // Create git log store
  let gitLogStore = $derived(createGitLogStore(dirCid, 1000));
  let commits = $state<Array<{ oid: string; message: string }>>([]);
  let headOid = $state<string | null>(null);

  // File last commit info (GitHub-style)
  let fileCommits = $state<Map<string, { oid: string; message: string; timestamp: number }>>(new Map());

  $effect(() => {
    const store = gitLogStore;
    const unsub = store.subscribe(value => {
      commits = value.commits;
      headOid = value.headOid;
    });
    return unsub;
  });

  // Detached HEAD state - show short commit hash instead of branch name
  let branchDisplay = $derived(currentBranch || (headOid ? headOid.slice(0, 7) : 'detached'));

  // Load file last commit info when entries or dirCid change
  $effect(() => {
    // Access props to track them for reactivity
    const cid = dirCid;
    const filenames = entries.map(e => e.name);

    if (!cid || filenames.length === 0) {
      fileCommits = new Map();
      return;
    }

    let cancelled = false;
    getFileLastCommits(cid, filenames).then(result => {
      if (!cancelled) {
        fileCommits = result;
      }
    }).catch(() => {
      // Silently ignore errors
    });
    return () => { cancelled = true; };
  });

  // Sort entries: directories first, then files, alphabetically
  let sortedEntries = $derived([...entries].sort((a, b) => {
    const aIsDir = a.type === LinkType.Dir;
    const bIsDir = b.type === LinkType.Dir;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  }));

  // Find and load README.md
  let readmeContent = $state<string | null>(null);

  $effect(() => {
    readmeContent = null;
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && e.type !== LinkType.Dir
    );
    if (!readmeEntry) return;

    let cancelled = false;
    getTree().readFile(readmeEntry.cid).then(data => {
      if (!cancelled && data) {
        const text = decodeAsText(data);
        if (text) readmeContent = text;
      }
    });
    return () => { cancelled = true; };
  });

  // Branch dropdown state
  let isDropdownOpen = $state(false);
  let showNewBranchInput = $state(false);
  let newBranchName = $state('');
  let isCreatingBranch = $state(false);
  let branchError = $state<string | null>(null);

  // Git status store
  let gitStatusStore = $derived(createGitStatusStore(dirCid));
  let gitStatus = $state<GitStatusResult>({ staged: [], unstaged: [], untracked: [], hasChanges: false });
  let statusLoading = $state(true);

  // Track dirCid changes to reset status (use a ref to avoid triggering effects)
  let lastDirCidRef = { current: dirCid };

  $effect(() => {
    const store = gitStatusStore;

    // If dirCid changed, reset to loading state immediately
    if (lastDirCidRef.current !== dirCid) {
      gitStatus = { staged: [], unstaged: [], untracked: [], hasChanges: false };
      statusLoading = true;
      lastDirCidRef.current = dirCid;
    }

    const unsub = store.subscribe(value => {
      gitStatus = value.status;
      statusLoading = value.loading;
    });
    return unsub;
  });

  // Total changes count
  let totalChanges = $derived(
    gitStatus.staged.length +
    gitStatus.unstaged.length +
    gitStatus.untracked.length
  );

  function buildEntryHref(entry: TreeEntry): string {
    const parts: string[] = [];
    const suffix = route.linkKey ? `?k=${route.linkKey}` : '';

    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...currentPath, entry.name);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...currentPath, entry.name);
    return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const iconMap: Record<string, string> = {
      js: 'i-lucide-file-code',
      ts: 'i-lucide-file-code',
      jsx: 'i-lucide-file-code',
      tsx: 'i-lucide-file-code',
      py: 'i-lucide-file-code',
      md: 'i-lucide-file-text',
      txt: 'i-lucide-file-text',
      json: 'i-lucide-file-json',
      png: 'i-lucide-image',
      jpg: 'i-lucide-image',
      gif: 'i-lucide-image',
      svg: 'i-lucide-image',
    };
    return iconMap[ext] || 'i-lucide-file';
  }

  function handleBranchSelect(branch: string) {
    // TODO: Implement branch checkout
    console.log('Switch to branch:', branch);
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
      // Note: The branch list will refresh when the page is reloaded
      // TODO: Could implement a refresh mechanism
    } catch (err) {
      branchError = err instanceof Error ? err.message : String(err);
    } finally {
      isCreatingBranch = false;
    }
  }

  // Handle commit callback - replaces the directory at current path
  async function handleCommit(newDirCid: CID): Promise<void> {
    const { autosaveIfOwn } = await import('../../nostr');
    const { getCurrentRootCid } = await import('../../actions/route');

    // Get current tree root
    const treeRootCid = getCurrentRootCid();
    if (!treeRootCid) return;

    let newRootCid;
    if (currentPath.length === 0) {
      // Git repo is at tree root - just use the new CID directly
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = currentPath.slice(0, -1);
      const dirName = currentPath[currentPath.length - 1];
      newRootCid = await tree.setEntry(
        treeRootCid,
        parentPath,
        dirName,
        newDirCid,
        0,
        LinkType.Dir
      );
    }

    // Save and publish - UI will react automatically via store subscriptions
    autosaveIfOwn(newRootCid);
  }

  // Format relative time like GitHub
  function formatRelativeTime(timestamp: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
    return `${Math.floor(diff / 31536000)} years ago`;
  }

  // Get first line of commit message (truncated)
  function getCommitTitle(message: string): string {
    const firstLine = message.split('\n')[0];
    return firstLine.length > 50 ? firstLine.slice(0, 47) + '...' : firstLine;
  }

  // Handle checkout from history modal
  async function handleCheckout(commitSha: string): Promise<void> {
    const { checkoutCommit } = await import('../../utils/git');
    const { autosaveIfOwn } = await import('../../nostr');
    const { getCurrentRootCid } = await import('../../actions/route');

    // Get current tree root
    const treeRootCid = getCurrentRootCid();
    if (!treeRootCid) return;

    // Checkout the commit - returns new directory CID with checked out files
    const newDirCid = await checkoutCommit(dirCid, commitSha);

    let newRootCid;
    if (currentPath.length === 0) {
      // Git repo is at tree root - just use the new CID directly
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = currentPath.slice(0, -1);
      const dirName = currentPath[currentPath.length - 1];
      newRootCid = await tree.setEntry(
        treeRootCid,
        parentPath,
        dirName,
        newDirCid,
        0,
        LinkType.Dir
      );
    }

    // Save and publish - UI will react automatically via store subscriptions
    autosaveIfOwn(newRootCid);
  }

  // Handle git shell changes (commits, etc.)
  async function handleGitChange(newDirCid: CID): Promise<void> {
    const { autosaveIfOwn } = await import('../../nostr');
    const { getCurrentRootCid } = await import('../../actions/route');

    // Get current tree root
    const treeRootCid = getCurrentRootCid();
    if (!treeRootCid) return;

    let newRootCid;
    if (currentPath.length === 0) {
      // Git repo is at tree root
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = currentPath.slice(0, -1);
      const dirName = currentPath[currentPath.length - 1];
      newRootCid = await tree.setEntry(
        treeRootCid,
        parentPath,
        dirName,
        newDirCid,
        0,
        LinkType.Dir
      );
    }

    // Save and publish
    autosaveIfOwn(newRootCid);
  }
</script>

<div class="flex flex-col gap-4">
  <!-- Tab navigation for Code/PRs/Issues - show for any git repo (not just tree root) -->
  {#if route.npub && route.treeName}
    {@const repoPath = currentPath.length > 0 ? `${route.treeName}/${currentPath.join('/')}` : route.treeName}
    <RepoTabNav npub={route.npub} repoName={repoPath} activeTab="code" />
  {/if}

  <!-- Folder actions -->
  <FolderActions {dirCid} {canEdit} />

  <!-- Directory listing table - GitHub style -->
  <div class="b-1 b-surface-3 b-solid rounded-lg overflow-hidden bg-surface-0">
    <!-- Branch info header row -->
    <div class="flex items-center gap-3 px-3 py-2 bg-surface-1 b-b-1 b-b-solid b-b-surface-3 text-sm">
      <!-- Branch dropdown -->
      <Dropdown bind:open={isDropdownOpen} onClose={() => { isDropdownOpen = false; showNewBranchInput = false; branchError = null; }}>
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

      <!-- Git status indicator and commit button -->
      {#if canEdit}
        {#if statusLoading}
          <span class="text-text-3 text-xs flex items-center gap-1">
            <span class="i-lucide-loader-2 animate-spin"></span>
          </span>
        {:else if totalChanges > 0}
          <button
            onclick={() => openGitCommitModal(dirCid, handleCommit)}
            class="btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
            title="{totalChanges} uncommitted change{totalChanges !== 1 ? 's' : ''}"
          >
            <span class="i-lucide-git-commit text-warning"></span>
            <span class="text-warning">{totalChanges}</span>
            <span class="hidden sm:inline">uncommitted</span>
          </button>
        {:else}
          <span class="text-text-3 text-xs flex items-center gap-1" title="No uncommitted changes">
            <span class="i-lucide-check-circle text-success"></span>
            <span class="hidden sm:inline">clean</span>
          </span>
        {/if}
      {/if}

      <button
        onclick={() => openGitShellModal(dirCid, canEdit, canEdit ? handleGitChange : undefined)}
        class="ml-auto btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
        title="Git Shell"
      >
        <span class="i-lucide-terminal"></span>
        Shell
      </button>

      <button
        onclick={() => openGitHistoryModal(dirCid, canEdit, canEdit ? handleCheckout : undefined)}
        class="btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
      >
        <span class="i-lucide-history"></span>
        {commits.length > 0 ? `${commits.length} commits` : 'Commits'}
      </button>
    </div>

    <!-- File table -->
    <table class="w-full text-sm border-collapse">
      <tbody>
        {#each sortedEntries as entry}
          {@const isGitDir = entry.name === '.git'}
          {@const href = buildEntryHref(entry)}
          {@const commitInfo = fileCommits.get(entry.name)}
          <tr
            onclick={() => window.location.hash = href.slice(1)}
            class="b-b-1 b-b-solid b-b-surface-3 hover:bg-surface-1 cursor-pointer {isGitDir ? 'opacity-50' : ''}"
          >
            <td class="py-2 px-3 w-8">
              <span class="{entry.type === LinkType.Dir ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}"></span>
            </td>
            <td class="py-2 px-3 {isGitDir ? 'text-text-3' : 'text-accent'} whitespace-nowrap">
              {entry.name}
            </td>
            <td class="py-2 px-3 text-muted truncate max-w-xs hidden md:table-cell" title={commitInfo?.message}>
              {commitInfo ? getCommitTitle(commitInfo.message) : ''}
            </td>
            <td class="py-2 px-3 text-right text-muted whitespace-nowrap w-24">
              {commitInfo ? formatRelativeTime(commitInfo.timestamp) : ''}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="4" class="py-4 px-3 text-center text-muted">
              Empty directory
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- README.md panel -->
  {#if readmeContent}
    <ReadmePanel content={readmeContent} {entries} {canEdit} />
  {/if}
</div>
