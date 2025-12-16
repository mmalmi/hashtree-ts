<script lang="ts">
  /**
   * VideoCard - 16:9 aspect ratio video card for video grid
   * Shows thumbnail preview if available
   */
  import { onMount } from 'svelte';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar, Name } from '../User';
  import { getTree } from '../../store';
  import { getTreeRootSync, subscribeToTreeRoot } from '../../stores';

  interface Props {
    href: string;
    title: string;
    duration?: number;
    ownerPubkey?: string | null;
    ownerNpub?: string | null;
    treeName?: string | null;
    visibility?: string;
  }

  let { href, title, duration, ownerPubkey, ownerNpub, treeName, visibility }: Props = $props();

  let thumbnailUrl = $state<string | null>(null);

  // Format duration as MM:SS or HH:MM:SS
  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Subscribe to tree root updates and load thumbnail when available
  onMount(() => {
    if (!ownerNpub || !treeName) return;

    // Try loading immediately if cached
    loadThumbnail();

    // Subscribe to resolver for updates
    const unsubscribe = subscribeToTreeRoot(ownerNpub, treeName, (hash) => {
      if (hash && !thumbnailUrl) {
        loadThumbnail();
      }
    });

    return () => {
      unsubscribe();
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  });

  async function loadThumbnail() {
    if (!ownerNpub || !treeName || thumbnailUrl) return;

    try {
      const rootCid = getTreeRootSync(ownerNpub, treeName);
      if (!rootCid) return;

      const tree = getTree();

      // Thumbnail is at thumbnail.jpg in the video tree root
      const result = await tree.resolvePath(rootCid, 'thumbnail.jpg');
      if (!result) return;

      const data = await tree.readFile(result.cid);
      if (!data) return;

      const blob = new Blob([data], { type: 'image/jpeg' });
      thumbnailUrl = URL.createObjectURL(blob);
    } catch {
      // Thumbnail not available
    }
  }
</script>

<a
  {href}
  class="rounded-lg hover:bg-surface-1 transition-all no-underline flex flex-col overflow-hidden group"
>
  <!-- Thumbnail with 16:9 aspect ratio -->
  <div class="relative aspect-video bg-surface-2 rounded-lg flex items-center justify-center overflow-hidden">
    {#if thumbnailUrl}
      <img src={thumbnailUrl} alt="" class="w-full h-full object-cover" />
    {:else}
      <span class="i-lucide-video text-2xl text-text-3"></span>
    {/if}

    <!-- Duration overlay -->
    {#if duration}
      <div class="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded">
        {formatDuration(duration)}
      </div>
    {/if}
  </div>

  <!-- Info - compact like YouTube -->
  <div class="pt-2 pb-1 flex gap-2">
    {#if ownerPubkey}
      <div class="shrink-0">
        <Avatar pubkey={ownerPubkey} size={24} />
      </div>
    {/if}
    <div class="min-w-0 flex-1">
      <h3 class="text-xs font-medium text-text-1 line-clamp-2 leading-tight">{title}</h3>
      <div class="flex items-center gap-1 text-[10px] text-text-3 mt-0.5">
        {#if ownerPubkey}
          <Name pubkey={ownerPubkey} />
        {/if}
        <VisibilityIcon {visibility} class="text-[10px]" />
      </div>
    </div>
  </div>
</a>
