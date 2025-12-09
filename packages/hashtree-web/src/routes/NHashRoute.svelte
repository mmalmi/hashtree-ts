<script lang="ts">
  import { onMount } from 'svelte';
  import FileBrowser from '../components/FileBrowser.svelte';
  import Viewer from '../components/Viewer/Viewer.svelte';
  import { nostrStore } from '../nostr';
  import { isViewingFileStore, currentHash } from '../stores';
  import { nhashDecode } from 'hashtree';

  interface Props {
    nhash: string;
  }

  let { nhash }: Props = $props();

  let hash = $derived($currentHash);
  let isViewingFile = $derived($isViewingFileStore);
  let isValid = $state(true);

  // Check if fullscreen mode from URL
  let isFullscreen = $derived.by(() => {
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return false;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    return params.get('fullscreen') === '1';
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
  <!-- File browser - hidden on mobile when file selected, hidden completely in fullscreen -->
  {#if !isFullscreen}
    <div class={isViewingFile
      ? 'hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col min-h-0'
      : 'flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col min-h-0'}>
      <FileBrowser />
    </div>
  {/if}
  <!-- Viewer - shown on mobile when file selected -->
  <div class={isViewingFile || isFullscreen
    ? 'flex flex-1 flex-col min-w-0 min-h-0'
    : 'hidden lg:flex flex-1 flex-col min-w-0 min-h-0'}>
    <Viewer />
  </div>
{:else}
  <div class="p-4 text-muted">Invalid nhash format</div>
{/if}
