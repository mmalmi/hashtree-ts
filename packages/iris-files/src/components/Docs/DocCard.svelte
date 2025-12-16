<script lang="ts">
  /**
   * DocCard - A4 aspect ratio document card for docs grid
   * Shows thumbnail preview if available
   */
  import { onMount } from 'svelte';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar } from '../User';
  import { getTree } from '../../store';
  import { getTreeRootSync } from '../../stores';
  import { getThumbnailFilename } from '../../lib/yjs/thumbnail';

  interface Props {
    href: string;
    displayName: string;
    ownerPubkey?: string | null;
    ownerNpub?: string | null;
    treeName?: string | null;
    visibility?: string;
  }

  let { href, displayName, ownerPubkey, ownerNpub, treeName, visibility }: Props = $props();

  let thumbnailUrl = $state<string | null>(null);

  // Load thumbnail on mount
  onMount(() => {
    loadThumbnail();
    return () => {
      // Revoke blob URL on unmount
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  });

  async function loadThumbnail() {
    if (!ownerNpub || !treeName) return;

    try {
      const rootCid = getTreeRootSync(ownerNpub, treeName);
      if (!rootCid) return;

      const tree = getTree();
      const thumbPath = getThumbnailFilename();

      // Resolve thumbnail path in doc root
      const result = await tree.resolvePath(rootCid, thumbPath);
      if (!result) return;

      // Read thumbnail data
      const data = await tree.get(result.cid);
      if (!data) return;

      // Create blob URL
      const blob = new Blob([data], { type: 'image/png' });
      thumbnailUrl = URL.createObjectURL(blob);
    } catch {
      // Thumbnail not available - that's fine
    }
  }
</script>

<a
  {href}
  class="aspect-[1/1.414] bg-surface-1 rounded-lg b-1 b-solid b-surface-3 hover:b-accent hover:shadow-md transition-all no-underline flex flex-col overflow-hidden"
>
  <div class="flex-1 flex items-center justify-center overflow-hidden">
    {#if thumbnailUrl}
      <img src={thumbnailUrl} alt="" class="w-full h-full object-cover object-top" />
    {:else}
      <span class="i-lucide-file-text text-4xl text-accent"></span>
    {/if}
  </div>
  <div class="p-2 bg-surface-1">
    <div class="flex items-center gap-1.5">
      {#if ownerPubkey}
        <Avatar pubkey={ownerPubkey} size={16} />
      {/if}
      <VisibilityIcon {visibility} class="text-text-3 text-xs" />
      <h3 class="text-sm font-medium text-text-1 truncate">{displayName}</h3>
    </div>
  </div>
</a>
