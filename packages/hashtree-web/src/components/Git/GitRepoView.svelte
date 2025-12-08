<script lang="ts">
  /**
   * GitRepoView - GitHub-style directory listing with README below
   * Shows branch info, file list table, then README.md in its own panel
   */
  import type { CID, TreeEntry } from 'hashtree';
  import { getTree, decodeAsText, formatBytes } from '../../store';
  import { routeStore, createGitLogStore, openGitHistoryModal } from '../../hooks';
  import FolderActions from '../FolderActions.svelte';
  import ReadmePanel from './ReadmePanel.svelte';

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

  $effect(() => {
    const store = gitLogStore;
    const unsub = store.subscribe(value => {
      commits = value.commits;
    });
    return unsub;
  });

  // Sort entries: directories first, then files, alphabetically
  let sortedEntries = $derived([...entries].sort((a, b) => {
    if (a.isTree && !b.isTree) return -1;
    if (!a.isTree && b.isTree) return 1;
    return a.name.localeCompare(b.name);
  }));

  // Find and load README.md
  let readmeContent = $state<string | null>(null);

  $effect(() => {
    readmeContent = null;
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && !e.isTree
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
</script>

<div class="flex flex-col gap-4">
  <!-- Folder actions -->
  <FolderActions {dirCid} {canEdit} />

  <!-- Directory listing table - GitHub style -->
  <div class="b-1 b-surface-3 b-solid rounded-lg overflow-hidden bg-surface-0">
    <!-- Branch info header row -->
    <div class="flex items-center gap-3 px-3 py-2 bg-surface-1 b-b-1 b-b-solid b-b-surface-3 text-sm">
      <!-- Branch dropdown -->
      {#if branches.length <= 1}
        <span class="btn-ghost flex items-center gap-1 px-3 h-9 text-sm cursor-default">
          <span class="i-lucide-git-branch"></span>
          {currentBranch || 'detached'}
        </span>
      {:else}
        <div class="relative">
          <button
            onclick={() => isDropdownOpen = !isDropdownOpen}
            class="btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
          >
            <span class="i-lucide-git-branch"></span>
            {currentBranch || 'detached'}
            <span class="i-lucide-chevron-down text-xs"></span>
          </button>
          {#if isDropdownOpen}
            <div class="absolute top-full left-0 mt-1 b-1 b-solid b-surface-3 rounded shadow-lg z-10 min-w-40 max-h-60 overflow-auto">
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
            </div>
          {/if}
        </div>
      {/if}

      <button
        onclick={() => openGitHistoryModal(dirCid)}
        class="ml-auto btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
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
          <tr
            onclick={() => window.location.hash = href.slice(1)}
            class="b-b-1 b-b-solid b-b-surface-3 hover:bg-surface-1 cursor-pointer {isGitDir ? 'opacity-50' : ''}"
          >
            <td class="py-2 px-3 w-8">
              <span class="{entry.isTree ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}"></span>
            </td>
            <td class="py-2 px-3 {isGitDir ? 'text-text-3' : 'text-accent'}">
              {entry.name}
            </td>
            <td class="py-2 px-3 text-right text-muted w-24">
              {!entry.isTree && entry.size !== undefined ? formatBytes(entry.size) : ''}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="py-4 px-3 text-center text-muted">
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
