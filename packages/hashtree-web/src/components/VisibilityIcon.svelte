<script lang="ts">
  /**
   * VisibilityIcon - displays icon for tree visibility level
   */
  import type { TreeVisibility } from 'hashtree';

  interface Props {
    visibility: TreeVisibility;
    class?: string;
  }

  let { visibility, class: className = '' }: Props = $props();

  function getVisibilityInfo(vis: TreeVisibility): { icon: string; title: string } {
    switch (vis) {
      case 'public':
        return { icon: 'i-lucide-globe', title: 'Public' };
      case 'unlisted':
        return { icon: 'i-lucide-link', title: 'Unlisted (link only)' };
      case 'private':
        return { icon: 'i-lucide-lock', title: 'Private' };
    }
  }

  let info = $derived(getVisibilityInfo(visibility));
</script>

{#if visibility === 'unlisted'}
  <!-- LinkLockIcon - combined link icon with small lock in bottom-right corner -->
  <span class="relative inline-block shrink-0 {className}" title={info.title}>
    <span class="i-lucide-link"></span>
    <span class="i-lucide-lock absolute -bottom-0.5 -right-1.5 text-[0.6em]"></span>
  </span>
{:else}
  <span
    class="shrink-0 {info.icon} {className}"
    title={info.title}
  ></span>
{/if}
