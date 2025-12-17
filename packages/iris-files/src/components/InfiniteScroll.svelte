<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    onLoadMore: () => void;
  }

  let { onLoadMore }: Props = $props();

  let sentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;

  function findNearestScrollingParent(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent) {
      const computedStyle = getComputedStyle(parent);
      const overflowY = computedStyle.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || parent.hasAttribute('data-scrollable')) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  onMount(() => {
    if (!sentinel) return;

    const scrollContainer = findNearestScrollingParent(sentinel);

    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: scrollContainer,
        rootMargin: '1000px',
        threshold: 1.0,
      }
    );

    observer.observe(sentinel);
  });

  onDestroy(() => {
    observer?.disconnect();
  });
</script>

<slot />
<div bind:this={sentinel} class="h-px" />
