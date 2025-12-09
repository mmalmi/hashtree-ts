<script lang="ts">
  /**
   * Visibility picker for selecting tree visibility (public/unlisted/private)
   */
  import type { TreeVisibility } from 'hashtree';

  interface Props {
    value: TreeVisibility;
    onchange: (value: TreeVisibility) => void;
  }

  let { value, onchange }: Props = $props();

  function getVisibilityTitle(vis: TreeVisibility): string {
    switch (vis) {
      case 'public': return 'Anyone can browse this folder';
      case 'unlisted': return 'Only accessible with a special link';
      case 'private': return 'Only you can access this folder';
    }
  }

  function getVisibilityIcon(vis: TreeVisibility): string {
    switch (vis) {
      case 'public': return 'i-lucide-globe';
      case 'unlisted': return 'i-lucide-link';
      case 'private': return 'i-lucide-lock';
    }
  }
</script>

<div>
  <label class="text-sm text-text-2 mb-2 block">Visibility</label>
  <div class="flex gap-2">
    {#each ['public', 'unlisted', 'private'] as vis}
      <button
        type="button"
        onclick={() => onchange(vis as TreeVisibility)}
        class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded border {value === vis
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-surface-3 text-text-1 hover:border-surface-4 hover:bg-surface-2'}"
        title={getVisibilityTitle(vis as TreeVisibility)}
      >
        <span class={getVisibilityIcon(vis as TreeVisibility)}></span>
        <span class="text-sm capitalize">{vis}</span>
      </button>
    {/each}
  </div>
  <p class="text-xs text-text-3 mt-2">
    {getVisibilityTitle(value)}
  </p>
</div>
