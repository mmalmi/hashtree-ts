<script lang="ts">
  import { modalsStore, closeShareModal } from '../../hooks/useModals';

  let show = $derived($modalsStore.showShareModal);
  let shareUrl = $derived($modalsStore.shareUrl);
  let copied = $state(false);

  async function copyToClipboard() {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={closeShareModal}>
    <div class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">Share</h2>
      <div class="flex gap-2 mb-4">
        <input type="text" value={shareUrl || ''} readonly class="input flex-1 text-sm" />
        <button onclick={copyToClipboard} class="btn-ghost">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div class="flex justify-end">
        <button onclick={closeShareModal} class="btn-ghost">Close</button>
      </div>
    </div>
  </div>
{/if}
