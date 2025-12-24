<script lang="ts">
  /**
   * VideoCard - 16:9 aspect ratio video card for video grid
   * Shows thumbnail preview if available via Service Worker URL
   */
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar, Name } from '../User';
  import { getNpubFileUrl } from '../../lib/mediaUrl';
  import { formatDuration } from '../../utils/format';

  interface Props {
    href: string;
    title: string;
    duration?: number;
    ownerPubkey?: string | null;
    ownerNpub?: string | null;
    treeName?: string | null;
    /** For playlist videos: the video folder name within the playlist tree */
    videoId?: string | null;
    visibility?: string;
  }

  let { href, title, duration, ownerPubkey, ownerNpub, treeName, videoId, visibility }: Props = $props();

  // Thumbnail extensions to try in order of preference
  const THUMB_EXTENSIONS = ['jpg', 'webp', 'png'];

  // Current extension index to try
  let thumbExtIndex = $state(0);

  // Use SW URL for thumbnail - browser caches this automatically
  // For playlist videos, include videoId in the file path: videoId/thumbnail.{ext}
  let thumbnailUrl = $derived.by(() => {
    if (!ownerNpub || !treeName) return null;
    const ext = THUMB_EXTENSIONS[thumbExtIndex] || 'jpg';
    // For playlist videos, videoId is a subfolder containing the thumbnail
    const filePath = videoId ? `${videoId}/thumbnail.${ext}` : `thumbnail.${ext}`;
    return getNpubFileUrl(ownerNpub, treeName, filePath);
  });

  let thumbnailError = $state(false);

  // Try next extension on error
  function handleThumbnailError() {
    if (thumbExtIndex < THUMB_EXTENSIONS.length - 1) {
      thumbExtIndex++;
    } else {
      thumbnailError = true;
    }
  }

</script>

<a
  {href}
  class="rounded-lg hover:bg-surface-1 transition-all no-underline flex flex-col overflow-hidden group"
>
  <!-- Thumbnail with 16:9 aspect ratio -->
  <div class="relative aspect-video bg-surface-2 rounded-lg flex items-center justify-center overflow-hidden">
    {#if thumbnailUrl && !thumbnailError}
      <img
        src={thumbnailUrl}
        alt=""
        class="w-full h-full object-cover"
        onerror={handleThumbnailError}
      />
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
