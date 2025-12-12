<script lang="ts">
  /**
   * GitRepoView - GitHub-style directory listing with README below
   * Shows branch info, file list table, then README.md in its own panel
   */
  import { LinkType, type CID, type TreeEntry } from 'hashtree';
  import { getTree, decodeAsText } from '../../store';
  import { routeStore, createGitLogStore, createGitStatusStore, openGitHistoryModal, openGitShellModal, openGitCommitModal } from '../../stores';
  import { getFileLastCommits } from '../../utils/git';
  import FolderActions from '../FolderActions.svelte';
  import ReadmePanel from '../Viewer/ReadmePanel.svelte';
  import RepoTabNav from './RepoTabNav.svelte';
  import BranchDropdown from './BranchDropdown.svelte';
  import FileTable from './FileTable.svelte';
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

  function handleBranchSelect(branch: string) {
    // TODO: Implement branch checkout
    console.log('Switch to branch:', branch);
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
      <BranchDropdown
        {branches}
        {currentBranch}
        {branchDisplay}
        {canEdit}
        {dirCid}
        onBranchSelect={handleBranchSelect}
      />

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
    <FileTable {entries} {fileCommits} {buildEntryHref} />
  </div>

  <!-- README.md panel -->
  {#if readmeContent}
    <ReadmePanel content={readmeContent} {entries} {canEdit} />
  {/if}
</div>
