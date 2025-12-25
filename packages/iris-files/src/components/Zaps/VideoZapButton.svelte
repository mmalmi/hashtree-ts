<script lang="ts">
  /**
   * VideoZapButton - Shows zap total and allows zapping a video
   * Self-contained component with its own subscription
   */
  import { untrack } from 'svelte';
  import { subscribeToZaps, insertZapSorted, type Zap } from '../../utils/zaps';
  import { open as openZapModal } from '../Modals/ZapModal.svelte';

  interface Props {
    videoIdentifier: string;
    ownerPubkey: string;
    isOwner?: boolean;
  }

  let { videoIdentifier, ownerPubkey, isOwner = false }: Props = $props();

  let allZaps = $state<Zap[]>([]);
  let zapCleanup = $state<(() => void) | null>(null);
  let totalSats = $derived(allZaps.reduce((sum, z) => sum + z.amountSats, 0));

  $effect(() => {
    const id = videoIdentifier;
    if (!id) return;

    untrack(() => {
      allZaps = [];
      zapCleanup = subscribeToZaps({ '#i': [id] }, (zap) => {
        allZaps = insertZapSorted(allZaps, zap);
      });
    });

    return () => {
      if (zapCleanup) {
        zapCleanup();
      }
    };
  });

  function handleZap() {
    if (!isOwner) {
      openZapModal(ownerPubkey, videoIdentifier);
    }
  }
</script>

{#if totalSats > 0 || !isOwner}
  <button
    onclick={handleZap}
    class="flex items-center gap-2 px-3 py-1.5 rounded-full {isOwner ? 'bg-surface-1 cursor-default' : 'bg-surface-1 hover:bg-surface-2 cursor-pointer'} text-yellow-400"
    disabled={isOwner}
    data-testid="zap-button"
  >
    <span class="i-lucide-zap text-lg"></span>
    {#if totalSats > 0}
      <span class="font-semibold">{totalSats.toLocaleString()}</span>
    {:else}
      <span class="text-sm">Zap</span>
    {/if}
  </button>
{/if}
