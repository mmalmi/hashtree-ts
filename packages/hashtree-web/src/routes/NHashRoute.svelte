<script lang="ts">
  import { onMount } from 'svelte';
  import FileBrowser from '../components/FileBrowser.svelte';
  import Viewer from '../components/Viewer/Viewer.svelte';
  import { nostrStore } from '../nostr';
  import { parseRoute, looksLikeFile } from '../utils/route';
  import { nhashDecode } from 'hashtree';

  interface Props {
    nhash: string;
  }

  let { nhash }: Props = $props();

  let hasFileSelected = $state(false);
  let isValid = $state(true);

  $effect(() => {
    const route = parseRoute();
    hasFileSelected = route.path.length > 0;
  });

  onMount(() => {
    nostrStore.setSelectedTree(null);

    try {
      nhashDecode(nhash); // Validate
      isValid = true;
    } catch {
      isValid = false;
    }
  });
</script>

{#if isValid}
  <!-- File browser - hidden on mobile when file selected -->
  <div class={hasFileSelected
    ? 'hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col'
    : 'flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col'}>
    <FileBrowser />
  </div>
  <!-- Viewer - shown on mobile when file selected -->
  <div class={hasFileSelected
    ? 'flex flex-1 flex-col min-w-0 min-h-0'
    : 'hidden lg:flex flex-1 flex-col min-w-0 min-h-0'}>
    <Viewer />
  </div>
{:else}
  <div class="p-4 text-muted">Invalid nhash format</div>
{/if}
