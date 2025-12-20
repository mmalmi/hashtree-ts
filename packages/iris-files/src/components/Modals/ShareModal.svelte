<script lang="ts">
  /**
   * ShareModal - unified sharing options with QR code, copy link, and native share
   */
  import QRCode from 'qrcode';
  import { modalsStore } from '../../stores/modals/store';
  import { closeShareModal } from '../../stores/modals/share';
  import CopyText from '../CopyText.svelte';

  let show = $derived($modalsStore.showShareModal);
  let shareUrl = $derived($modalsStore.shareUrl);
  let qrDataUrl = $state<string | null>(null);

  // Generate QR code when modal opens
  $effect(() => {
    if (!show || !shareUrl) {
      qrDataUrl = null;
      return;
    }
    generateQrCode(shareUrl).then((url) => (qrDataUrl = url));
  });

  // Handle Escape key to close modal
  $effect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement)?.blur();
        closeShareModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  async function handleNativeShare() {
    if (navigator.share && shareUrl) {
      try {
        await navigator.share({ url: shareUrl });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Share failed:', e);
        }
      }
    }
  }

  async function generateQrCode(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }
</script>

{#if show && shareUrl}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/70 flex-center z-1000 overflow-auto"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeShareModal();
    }}
    data-testid="share-modal-backdrop"
  >
    <div
      class="bg-surface-1 sm:rounded-lg overflow-auto w-screen sm:w-96 sm:border border-surface-3 max-h-full my-auto"
      data-testid="share-modal"
    >
      <!-- QR Code - click to close -->
      <div class="cursor-pointer" onclick={closeShareModal}>
        {#if qrDataUrl}
          <img
            src={qrDataUrl}
            alt="QR Code"
            class="w-full max-h-screen object-contain bg-white"
            data-testid="share-qr-code"
          />
        {:else}
          <div class="w-full aspect-square max-h-screen bg-surface-2 flex-center">
            <span class="i-lucide-loader-2 animate-spin text-2xl text-text-3"></span>
          </div>
        {/if}
      </div>

      <!-- URL with copy -->
      <div class="bg-surface-2 p-3 m-4 mb-2 rounded">
        <CopyText text={shareUrl} truncate={80} class="text-sm" testId="share-copy-url" />
      </div>

      <!-- Native share button -->
      {#if typeof navigator !== 'undefined' && 'share' in navigator}
        <div class="px-4 pb-4 pt-2">
          <button onclick={handleNativeShare} class="btn-ghost w-full flex items-center justify-center gap-2">
            <span class="i-lucide-share"></span>
            Share via...
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
