<script lang="ts">
  /**
   * Modal for creating new files, folders, or trees
   * Port of React CreateModal component
   */
  import { modalsStore, closeCreateModal, setModalInput, setCreateTreeVisibility } from '../../stores/modals';
  import { createFile, createFolder, createTree, createDocument } from '../../actions';
  import { routeStore } from '../../stores';
  import VisibilityPicker from './VisibilityPicker.svelte';

  let show = $derived($modalsStore.showCreateModal);
  let modalInput = $derived($modalsStore.modalInput);
  let modalType = $derived($modalsStore.createModalType);
  let createTreeVisibility = $derived($modalsStore.createTreeVisibility);
  let route = $derived($routeStore);

  let isCreating = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);

  // Focus input when modal opens
  $effect(() => {
    if (show && inputRef) {
      inputRef.focus();
    }
  });

  let isFolder = $derived(modalType === 'folder');
  let isTree = $derived(modalType === 'tree');
  let isDocument = $derived(modalType === 'document');

  let title = $derived(
    isTree ? 'New Folder' : isDocument ? 'New Document' : isFolder ? 'New Folder' : 'New File'
  );
  let placeholder = $derived(
    isDocument ? 'Document name...' : (isTree || isFolder ? 'Folder name...' : 'File name...')
  );

  async function handleSubmit(e?: Event) {
    e?.preventDefault();
    const name = modalInput.trim();
    if (!name || isCreating) return;

    if (isTree) {
      isCreating = true;
      await createTree(name, createTreeVisibility);
      isCreating = false;
      closeCreateModal();
    } else if (isDocument) {
      // Create a document folder with .yjs config file inside
      await createDocument(name);
      closeCreateModal();
      // Navigate into the new document folder
      if (route.npub && route.treeName) {
        const newPath = [...route.path, name].map(encodeURIComponent).join('/');
        const linkKeyParam = route.linkKey ? `?k=${route.linkKey}` : '';
        window.location.hash = `/${route.npub}/${route.treeName}/${newPath}${linkKeyParam}`;
      }
    } else if (isFolder) {
      createFolder(name);
      closeCreateModal();
    } else {
      createFile(name, '');
      closeCreateModal();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeCreateModal();
    if (e.key === 'Enter') handleSubmit();
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    onclick={closeCreateModal}
  >
    <div
      class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeyDown}
    >
      <h2 class="text-lg font-semibold mb-4">{title}</h2>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <input
          bind:this={inputRef}
          type="text"
          value={modalInput}
          oninput={(e) => setModalInput((e.target as HTMLInputElement).value)}
          placeholder={placeholder}
          class="input w-full mb-4"
        />

        <!-- Visibility picker for trees -->
        {#if isTree}
          <div class="mt-4 mb-4">
            <VisibilityPicker value={createTreeVisibility} onchange={setCreateTreeVisibility} />
          </div>
        {/if}

        <div class="flex justify-end gap-2">
          <button type="button" onclick={closeCreateModal} class="btn-ghost">Cancel</button>
          <button type="submit" class="btn-success" disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
