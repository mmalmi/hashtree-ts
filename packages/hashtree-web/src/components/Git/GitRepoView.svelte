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
  import type { CommitInfo } from '../../stores/git';

  interface Props {
    dirCid: CID;
    /** Git root CID - use this for git operations when in a subdirectory */
    gitRootCid: CID | null;
    entries: TreeEntry[];
    canEdit: boolean;
    currentBranch: string | null;
    branches: string[];
  }

  let { dirCid, gitRootCid, entries, canEdit, currentBranch, branches }: Props = $props();

  // Use gitRootCid for git operations, fall back to dirCid if not provided (at git root)
  let gitCid = $derived(gitRootCid ?? dirCid);

  let route = $derived($routeStore);
  let currentPath = $derived(route.path);

  // Create git log store - use gitCid (git root) for log
  let gitLogStore = $derived(createGitLogStore(gitCid, 1000));
  let commits = $state<CommitInfo[]>([]);
  let headOid = $state<string | null>(null);
  let commitsLoading = $state(true);

  // Latest commit for the header row
  let latestCommit = $derived(commits.length > 0 ? commits[0] : null);

  // File last commit info (GitHub-style)
  let fileCommits = $state<Map<string, { oid: string; message: string; timestamp: number }>>(new Map());

  $effect(() => {
    const store = gitLogStore;
    const unsub = store.subscribe(value => {
      commits = value.commits;
      headOid = value.headOid;
      commitsLoading = value.loading;
    });
    return unsub;
  });

  // Detached HEAD state - show short commit hash instead of branch name
  let branchDisplay = $derived(currentBranch || (headOid ? headOid.slice(0, 7) : 'detached'));

  // Load file last commit info when entries or gitCid change
  // Use gitCid for git operations, but track entries for file names
  $effect(() => {
    // Access props to track them for reactivity
    const cid = gitCid;
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

  // Git status store - use gitCid (git root) for status
  let gitStatusStore = $derived(createGitStatusStore(gitCid));
  let gitStatus = $state<GitStatusResult>({ staged: [], unstaged: [], untracked: [], hasChanges: false });
  let statusLoading = $state(true);

  // Track gitCid changes to reset status (use a ref to avoid triggering effects)
  let lastGitCidRef = { current: gitCid };

  $effect(() => {
    const store = gitStatusStore;

    // If gitCid changed, reset to loading state immediately
    if (lastGitCidRef.current !== gitCid) {
      gitStatus = { staged: [], unstaged: [], untracked: [], hasChanges: false };
      statusLoading = true;
      lastGitCidRef.current = gitCid;
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

  // Build query string for entry hrefs
  function buildQueryString(): string {
    const params: string[] = [];
    if (route.linkKey) params.push(`k=${route.linkKey}`);
    // Propagate gitRoot - if we're at git root (gitRootPath is null), use current path
    // If we're in subdirectory (gitRootPath is set), keep using it
    const effectiveGitRoot = gitRootPath !== null ? gitRootPath : (currentPath.length > 0 ? currentPath.join('/') : '');
    if (effectiveGitRoot !== null) params.push(`g=${encodeURIComponent(effectiveGitRoot)}`);
    return params.length > 0 ? '?' + params.join('&') : '';
  }

  function buildEntryHref(entry: TreeEntry): string {
    const parts: string[] = [];
    const suffix = buildQueryString();

    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...currentPath, entry.name);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...currentPath, entry.name);
    return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  function buildCommitHref(commitOid: string): string {
    const parts: string[] = [];
    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...currentPath);
    }
    const basePath = '#/' + parts.map(encodeURIComponent).join('/');
    return `${basePath}?commit=${commitOid}`;
  }

  // Build parent directory href (for ".." navigation)
  let parentHref = $derived.by(() => {
    if (currentPath.length === 0) return null; // At root, no parent
    const parts: string[] = [];
    const parentPath = currentPath.slice(0, -1);
    const suffix = buildQueryString();

    if (route.npub && route.treeName) {
      parts.push(route.npub, route.treeName, ...parentPath);
      return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...parentPath);
    return '#/' + parts.map(encodeURIComponent).join('/') + suffix;
  });

  // Get git root path from route (for subdirectory operations)
  let gitRootPath = $derived(route.gitRoot);

  // Handle branch selection - checkout the branch
  async function handleBranchSelect(branch: string) {
    // Skip if already on this branch
    if (branch === currentBranch) return;

    const { checkoutCommit } = await import('../../utils/git');
    const { autosaveIfOwn } = await import('../../nostr');
    const { getCurrentRootCid } = await import('../../actions/route');

    // Get current tree root
    const treeRootCid = getCurrentRootCid();
    if (!treeRootCid) return;

    try {
      // Checkout the branch - use gitCid for git operations
      const newDirCid = await checkoutCommit(gitCid, branch);

      // Determine the path to the git root (use gitRootPath if in subdirectory, otherwise currentPath)
      const gitPath = gitRootPath !== null
        ? (gitRootPath === '' ? [] : gitRootPath.split('/'))
        : currentPath;

      let newRootCid;
      if (gitPath.length === 0) {
        // Git repo is at tree root
        newRootCid = newDirCid;
      } else {
        // Git repo is in a subdirectory - replace it at that path
        const tree = getTree();
        const parentPath = gitPath.slice(0, -1);
        const dirName = gitPath[gitPath.length - 1];
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
    } catch (err) {
      console.error('Failed to switch branch:', err);
    }
  }

  // Helper to get git path (either from URL param or current path if at git root)
  function getGitPath(): string[] {
    if (gitRootPath !== null) {
      return gitRootPath === '' ? [] : gitRootPath.split('/');
    }
    return currentPath;
  }

  // Handle commit callback - replaces the git repo at its path
  async function handleCommit(newDirCid: CID): Promise<void> {
    const { autosaveIfOwn } = await import('../../nostr');
    const { getCurrentRootCid } = await import('../../actions/route');

    // Get current tree root
    const treeRootCid = getCurrentRootCid();
    if (!treeRootCid) return;

    const gitPath = getGitPath();
    let newRootCid;
    if (gitPath.length === 0) {
      // Git repo is at tree root - just use the new CID directly
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = gitPath.slice(0, -1);
      const dirName = gitPath[gitPath.length - 1];
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

    // Checkout the commit - use gitCid for git operations
    const newDirCid = await checkoutCommit(gitCid, commitSha);

    const gitPath = getGitPath();
    let newRootCid;
    if (gitPath.length === 0) {
      // Git repo is at tree root - just use the new CID directly
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = gitPath.slice(0, -1);
      const dirName = gitPath[gitPath.length - 1];
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

    const gitPath = getGitPath();
    let newRootCid;
    if (gitPath.length === 0) {
      // Git repo is at tree root
      newRootCid = newDirCid;
    } else {
      // Git repo is in a subdirectory - replace it at that path
      const tree = getTree();
      const parentPath = gitPath.slice(0, -1);
      const dirName = gitPath[gitPath.length - 1];
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

<!-- Tab navigation for Code/PRs/Issues - show for any git repo (not just tree root) -->
{#if route.npub && route.treeName}
  {@const repoPath = currentPath.length > 0 ? `${route.treeName}/${currentPath.join('/')}` : route.treeName}
  <RepoTabNav npub={route.npub} repoName={repoPath} activeTab="code" />
{/if}

<div class="flex flex-col gap-4 p-3">
  <!-- Folder actions -->
  <FolderActions {dirCid} {canEdit} />

  <!-- Branch selector row (above table, like GitHub) -->
  <div class="flex flex-wrap items-center gap-3 text-sm">
    <!-- Branch dropdown - use gitCid for git operations -->
    <BranchDropdown
      {branches}
      {currentBranch}
      {branchDisplay}
      {canEdit}
      dirCid={gitCid}
      onBranchSelect={handleBranchSelect}
    />

    <!-- Branch count -->
    <span class="flex items-center gap-1.5 text-sm text-text-2">
      <span class="i-lucide-git-branch text-text-3"></span>
      <span>{branches.length} branch{branches.length !== 1 ? 'es' : ''}</span>
    </span>

    <!-- Git status indicator and commit button -->
    {#if canEdit}
      {#if statusLoading}
        <span class="text-text-3 text-xs flex items-center gap-1">
          <span class="i-lucide-loader-2 animate-spin"></span>
        </span>
      {:else if totalChanges > 0}
        <button
          onclick={() => openGitCommitModal(gitCid, handleCommit)}
          class="btn-ghost flex items-center gap-1 px-2 h-8 text-sm"
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

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Shell button -->
    <button
      onclick={() => openGitShellModal(gitCid, canEdit, canEdit ? handleGitChange : undefined)}
      class="btn-ghost flex items-center gap-1 px-2 h-8 text-sm"
      title="Git Shell"
    >
      <span class="i-lucide-terminal"></span>
      <span class="hidden sm:inline">Shell</span>
    </button>

    <!-- Commits count (clickable) -->
    <button
      onclick={() => openGitHistoryModal(gitCid, canEdit, canEdit ? handleCheckout : undefined)}
      class="flex items-center gap-1.5 text-sm text-text-2 hover:text-accent bg-transparent b-0 cursor-pointer"
    >
      <span class="i-lucide-history text-text-3"></span>
      <span>{commits.length > 0 ? `${commits.length} commits` : 'Commits'}</span>
    </button>
  </div>

  <!-- Directory listing table - GitHub style -->
  <div class="b-1 b-surface-3 b-solid rounded-lg overflow-hidden bg-surface-0">
    <!-- File table with commit info header -->
    <FileTable {entries} {fileCommits} {buildEntryHref} {buildCommitHref} {latestCommit} {commitsLoading} {parentHref} />
  </div>

  <!-- README.md panel -->
  {#if readmeContent}
    <ReadmePanel content={readmeContent} {entries} {canEdit} />
  {/if}
</div>
