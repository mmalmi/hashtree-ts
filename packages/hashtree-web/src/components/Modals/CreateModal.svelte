<script lang="ts">
  /**
   * Modal for creating new files, folders, or trees
   * Port of React CreateModal component
   */
  import type { TreeVisibility } from 'hashtree';
  import { modalsStore, closeCreateModal, setModalInput, setCreateTreeVisibility } from '../../hooks/useModals';
  import { createFile, createFolder, createTree, createDocument } from '../../actions';
  import { routeStore } from '../../hooks';

  let show = $derived($modalsStore.showCreateModal);
  let modalInput = $derived($modalsStore.modalInput);
  let modalType = $derived($modalsStore.createModalType);
  let createTreeVisibility = $derived($modalsStore.createTreeVisibility);
  let route = $derived($routeStore);

  let isCreating = $state(false);

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

  function getVisibilityTitle(vis: TreeVisibility): string {
    switch (vis) {
      case 'public': return 'Anyone can browse this folder';
      case 'unlisted': return 'Only accessible with a special link';
      case 'private': return 'Only you can access this folder';
    }
  }

  function getVisibilityIcon(vis: TreeVisibility): string {
    switch (vis) {
      case 'public': return 'i-lucide-globe';
      case 'unlisted': return 'i-lucide-link';
      case 'private': return 'i-lucide-lock';
    }
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
      <form onsubmit={handleSubmit}>
        <input
          type="text"
          value={modalInput}
          oninput={(e) => setModalInput((e.target as HTMLInputElement).value)}
          placeholder={placeholder}
          class="input w-full mb-4"
          autofocus
        />

        <!-- Visibility picker for trees -->
        {#if isTree}
          <div class="mt-4 mb-4">
            <label class="text-sm text-text-2 mb-2 block">Visibility</label>
            <div class="flex gap-2">
              {#each ['public', 'unlisted', 'private'] as vis}
                <button
                  type="button"
                  onclick={() => setCreateTreeVisibility(vis as TreeVisibility)}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded border {createTreeVisibility === vis
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-surface-3 text-text-1 hover:border-surface-4 hover:bg-surface-2'}"
                  title={getVisibilityTitle(vis as TreeVisibility)}
                >
                  <span class={getVisibilityIcon(vis as TreeVisibility)}></span>
                  <span class="text-sm capitalize">{vis}</span>
                </button>
              {/each}
            </div>
            <p class="text-xs text-text-3 mt-2">
              {getVisibilityTitle(createTreeVisibility)}
            </p>
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
