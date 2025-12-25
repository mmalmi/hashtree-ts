<script lang="ts">
  /**
   * VideoZapButton - Shows zap total and allows zapping a video
   * Self-contained component with its own subscription
   */
  import { untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { subscribeToZaps, insertZapSorted, type Zap } from '../../utils/zaps';
  import { createProfileStore } from '../../stores/profile';
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

  // Check if owner has lightning address
  let ownerNpub = $derived(ownerPubkey ? nip19.npubEncode(ownerPubkey) : '');
  let profileStore = $derived(ownerNpub ? createProfileStore(ownerNpub) : null);
  let profile = $state<{ lud16?: string } | null>(null);
  let hasLightningAddress = $derived(!!profile?.lud16);
  let canZap = $derived(!isOwner && hasLightningAddress);
  let isDisabled = $derived(!isOwner && !hasLightningAddress); // Only disabled if other user has no lud16

  $effect(() => {
    if (!profileStore) return;
    const unsub = profileStore.subscribe(value => {
      profile = value;
    });
    return unsub;
  });

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
    if (canZap) {
      openZapModal(ownerPubkey, videoIdentifier);
    }
  }
</script>

<button
  onclick={handleZap}
  class="flex items-center gap-2 px-3 py-1.5 rounded-full {isDisabled ? 'bg-surface-1 cursor-default opacity-50' : 'bg-surface-1 hover:bg-surface-2 cursor-pointer'} text-yellow-400"
  disabled={isDisabled}
  title={isDisabled ? 'No lightning address' : undefined}
  data-testid="zap-button"
>
  <span class="i-lucide-zap text-lg"></span>
  {#if totalSats > 0}
    <span class="font-semibold">{totalSats.toLocaleString()}</span>
  {:else if canZap}
    <span class="text-sm">Zap</span>
  {:else}
    <span class="text-sm">0</span>
  {/if}
</button>
