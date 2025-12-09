<script lang="ts">
  import SearchInput from './SearchInput.svelte';

  let expanded = $state(false);
  let containerRef: HTMLDivElement | undefined = $state();

  // Close on click outside
  $effect(() => {
    if (!expanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        expanded = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  // Close on escape
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      expanded = false;
    }
  }
</script>

<div bind:this={containerRef} class="md:hidden">
  {#if expanded}
    <!-- Expanded search overlay -->
    <div class="absolute left-0 right-0 top-0 h-12 bg-surface-1 flex items-center px-3 z-50" onkeydown={handleKeyDown}>
      <div class="flex-1">
        <SearchInput />
      </div>
      <button
        onclick={() => (expanded = false)}
        class="p-2 text-muted hover:text-text-1"
        aria-label="Close search"
      >
        <span class="i-lucide-x text-lg" />
      </button>
    </div>
  {:else}
    <!-- Search icon button -->
    <button
      onclick={() => (expanded = true)}
      class="p-2 text-muted hover:text-text-1"
      aria-label="Search"
    >
      <span class="i-lucide-search text-lg" />
    </button>
  {/if}
</div>
