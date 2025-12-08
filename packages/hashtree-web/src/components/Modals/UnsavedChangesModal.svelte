<script lang="ts">
  import { modalsStore, closeUnsavedChangesModal } from '../../hooks/useModals';
  let show = $derived($modalsStore.showUnsavedChangesModal);
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={closeUnsavedChangesModal}>
    <div class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">Unsaved Changes</h2>
      <p class="text-muted mb-4">You have unsaved changes. What would you like to do?</p>
      <div class="flex justify-end gap-2">
        <button onclick={closeUnsavedChangesModal} class="btn-ghost">Don't Save</button>
        <button onclick={closeUnsavedChangesModal} class="btn-success">Save</button>
      </div>
    </div>
  </div>
{/if}
