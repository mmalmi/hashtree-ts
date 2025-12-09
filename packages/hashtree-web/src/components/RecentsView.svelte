<script lang="ts">
  /**
   * RecentsView - shows recently accessed files and trees
   */
  import { nip19 } from 'nostr-tools';
  import { recentsStore, clearRecents, type RecentItem } from '../stores/recents';
  import { getFileIcon } from '../utils/fileIcon';
  import Avatar from './User/Avatar.svelte';
  import VisibilityIcon from './VisibilityIcon.svelte';

  let recents = $derived($recentsStore);

  function getIcon(item: RecentItem): string {
    switch (item.type) {
      case 'tree': return 'i-lucide-folder';
      case 'dir': return 'i-lucide-folder';
      case 'file': return getFileIcon(item.label);
      case 'hash': return 'i-lucide-folder';
      default: return 'i-lucide-file';
    }
  }

  function npubToPubkey(npub: string): string | null {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }
    } catch {}
    return null;
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
</script>

<div class="flex-1 flex flex-col min-h-0">
  <div class="h-10 shrink-0 px-4 border-b border-surface-3 flex items-center bg-surface-1">
    <span class="text-sm font-medium text-text-1">Recent</span>
    {#if recents.length > 0}
      <span class="ml-2 text-xs text-text-3">{recents.length}</span>
      <button
        class="ml-auto btn-ghost text-xs px-2 py-1"
        onclick={() => clearRecents()}
        title="Clear recents"
      >
        Clear
      </button>
    {/if}
  </div>
  <div class="flex-1 overflow-auto">
    {#if recents.length === 0}
      <div class="p-4 text-muted text-sm">
        No recent items
      </div>
    {:else}
      <div>
        {#each recents as item (item.path)}
          {@const icon = getIcon(item)}
          {@const pubkey = item.npub ? npubToPubkey(item.npub) : null}
          {@const isFolder = item.type === 'tree' || item.type === 'dir' || item.type === 'hash'}
          <a
            href="#{item.path}"
            class="w-full px-4 py-2 flex items-center gap-3 bg-surface-0 hover:bg-surface-1 transition-colors text-left b-0 no-underline"
          >
            {#if pubkey}
              <Avatar {pubkey} size={20} class="shrink-0" />
            {:else}
              <span class="i-lucide-hash text-accent shrink-0"></span>
            {/if}
            <span class="{icon} shrink-0 {isFolder ? 'text-warning' : 'text-text-2'}"></span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-text-1 truncate">{item.label}</div>
              {#if item.treeName}
                <div class="text-xs text-text-3 truncate">{item.treeName}</div>
              {/if}
            </div>
            {#if item.visibility}
              <VisibilityIcon visibility={item.visibility} class="text-text-3 shrink-0" />
            {/if}
            <span class="text-xs text-text-3 shrink-0">{formatTime(item.timestamp)}</span>
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>
