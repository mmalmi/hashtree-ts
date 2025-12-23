<script lang="ts">
  /**
   * PlaylistCard - Card for displaying a playlist in grids
   */

  interface Props {
    href: string;
    title: string;
    videoCount: number;
    ownerPubkey?: string | null;
    ownerNpub?: string;
    treeName?: string;
    visibility?: string;
  }

  let { href, title, videoCount, ownerPubkey, ownerNpub, treeName, visibility }: Props = $props();
</script>

<a {href} class="block no-underline group">
  <div class="relative aspect-video bg-surface-2 rounded-lg overflow-hidden">
    <!-- Playlist overlay -->
    <div class="absolute inset-0 flex items-center justify-center bg-surface-1/80">
      <div class="text-center">
        <span class="i-lucide-list-video text-4xl text-accent mb-2 block"></span>
        <span class="text-text-1 font-medium">{videoCount} videos</span>
      </div>
    </div>

    <!-- Hover overlay -->
    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
  </div>

  <div class="mt-2">
    <h3 class="text-sm font-medium text-text-1 line-clamp-2 leading-tight group-hover:text-accent transition-colors">
      {title}
    </h3>
    <div class="flex items-center gap-1 mt-1 text-xs text-text-3">
      <span class="i-lucide-folder text-xs"></span>
      <span>Playlist</span>
      {#if visibility && visibility !== 'public'}
        <span class="text-text-3">·</span>
        <span class="capitalize">{visibility}</span>
      {/if}
    </div>
  </div>
</a>
