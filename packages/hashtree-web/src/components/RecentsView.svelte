<script lang="ts">
  /**
   * RecentsView - shows recently accessed files and trees
   */
  import { recentsStore, type RecentItem } from '../stores/recents';
  import { navigate } from '../utils/navigate';

  let recents = $derived($recentsStore);

  function getIcon(type: RecentItem['type']): string {
    switch (type) {
      case 'tree': return 'i-lucide-folder';
      case 'dir': return 'i-lucide-folder';
      case 'file': return 'i-lucide-file';
      case 'hash': return 'i-lucide-link';
      default: return 'i-lucide-file';
    }
  }

  function formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  function handleClick(item: RecentItem) {
    navigate(item.path);
  }
</script>

<div class="flex-1 flex flex-col min-h-0">
  <div class="h-10 shrink-0 px-4 border-b border-surface-3 flex items-center bg-surface-1">
    <span class="text-sm font-medium text-text-1">Recent</span>
    {#if recents.length > 0}
      <span class="ml-2 text-xs text-text-3">{recents.length}</span>
    {/if}
  </div>
  <div class="flex-1 overflow-auto">
    {#if recents.length === 0}
      <div class="p-4 text-muted text-sm">
        No recent items
      </div>
    {:else}
      <div class="divide-y divide-surface-2">
        {#each recents as item (item.path)}
          <button
            class="w-full px-4 py-2 flex items-center gap-3 hover:bg-surface-1 transition-colors text-left"
            onclick={() => handleClick(item)}
          >
            <span class="{getIcon(item.type)} text-text-3 shrink-0"></span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-text-1 truncate">{item.label}</div>
              {#if item.treeName}
                <div class="text-xs text-text-3 truncate">{item.treeName}</div>
              {/if}
            </div>
            <span class="text-xs text-text-3 shrink-0">{formatTime(item.timestamp)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
