<script lang="ts">
  /**
   * FileTable - GitHub-style file listing with commit info
   */
  import { LinkType, type TreeEntry } from 'hashtree';

  interface Props {
    entries: TreeEntry[];
    fileCommits: Map<string, { oid: string; message: string; timestamp: number }>;
    buildEntryHref: (entry: TreeEntry) => string;
  }

  let { entries, fileCommits, buildEntryHref }: Props = $props();

  // Sort entries: directories first, then files, alphabetically
  let sortedEntries = $derived([...entries].sort((a, b) => {
    const aIsDir = a.type === LinkType.Dir;
    const bIsDir = b.type === LinkType.Dir;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  }));

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
</script>

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
