<script lang="ts">
  import { modalsStore, closeForkModal } from '../../hooks/useModals';
  let show = $derived($modalsStore.showForkModal);
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={closeForkModal}>
    <div class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">Fork</h2>
      <p class="text-muted mb-4">Fork modal placeholder</p>
      <div class="flex justify-end">
        <button onclick={closeForkModal} class="btn-ghost">Close</button>
      </div>
    </div>
  </div>
{/if}
