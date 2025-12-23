<script lang="ts">
  /**
   * PlaylistCard - Card for displaying a playlist in grids
   * Shows thumbnail with YouTube-style stacked effect and playlist overlay
   */

  interface Props {
    href: string;
    title: string;
    videoCount: number;
    thumbnailUrl?: string;
    ownerPubkey?: string | null;
    ownerNpub?: string;
    treeName?: string;
    visibility?: string;
  }

  let { href, title, videoCount, thumbnailUrl, ownerPubkey, ownerNpub, treeName, visibility }: Props = $props();
</script>

<a {href} class="block no-underline group">
  <div class="relative aspect-video rounded-lg overflow-hidden">
    <!-- Stacked effect (background cards) -->
    <div class="absolute -right-1 -top-1 w-full h-full bg-surface-3 rounded-lg"></div>
    <div class="absolute -right-0.5 -top-0.5 w-full h-full bg-surface-2 rounded-lg"></div>

    <!-- Main thumbnail -->
    <div class="relative w-full h-full bg-surface-2 rounded-lg overflow-hidden">
      {#if thumbnailUrl}
        <img
          src={thumbnailUrl}
          alt=""
          class="w-full h-full object-cover"
          loading="lazy"
        />
      {:else}
        <div class="w-full h-full flex items-center justify-center bg-surface-1">
          <span class="i-lucide-video text-4xl text-text-3"></span>
        </div>
      {/if}

      <!-- Playlist count overlay (right side like YouTube) -->
      <div class="absolute right-0 top-0 bottom-0 w-24 bg-black/80 flex flex-col items-center justify-center">
        <span class="text-white text-lg font-medium">{videoCount}</span>
        <span class="i-lucide-list-video text-white text-xl mt-1"></span>
      </div>

      <!-- Hover overlay -->
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
    </div>
  </div>

  <div class="mt-2">
    <h3 class="text-sm font-medium text-text-1 line-clamp-2 leading-tight group-hover:text-accent transition-colors">
      {title}
    </h3>
    <div class="flex items-center gap-1 mt-1 text-xs text-text-3">
      <span class="i-lucide-list-video text-xs"></span>
      <span>Playlist</span>
      {#if visibility && visibility !== 'public'}
        <span class="text-text-3">·</span>
        <span class="capitalize">{visibility}</span>
      {/if}
    </div>
  </div>
</a>
