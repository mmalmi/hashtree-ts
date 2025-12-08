<script lang="ts">
  /**
   * Yjs Document Editor - Tiptap-based collaborative editor
   * Shows when a directory contains a .yjs file
   */
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import * as Y from 'yjs';
  import Collaboration from '@tiptap/extension-collaboration';
  import { toHex } from 'hashtree';
  import type { CID, TreeEntry } from 'hashtree';
  import { getTree } from '../../store';
  import { routeStore } from '../../hooks';
  import { autosaveIfOwn, useNostrStore } from '../../nostr';
  import { getCurrentRootCid } from '../../actions/route';
  import { nip19 } from 'nostr-tools';

  interface Props {
    dirCid: CID;
    dirName: string;
    entries: TreeEntry[];
  }

  let { dirCid, dirName, entries }: Props = $props();

  let route = $derived($routeStore);
  let nostrState = $derived(useNostrStore.getState());
  let editorElement: HTMLElement | undefined = $state();
  let editor: Editor | undefined = $state();
  let ydoc: Y.Doc | undefined = $state();
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Editors modal state
  let showEditorsModal = $state(false);
  let editors = $state<string[]>([]); // List of npubs
  let newEditorInput = $state('');
  let addError = $state<string | null>(null);
  let loadingEditors = $state(true);

  // Check if current user is owner of this tree
  let isOwner = $derived(() => {
    if (!route.npub || !nostrState.npub) return false;
    return route.npub === nostrState.npub;
  });

  // Find the .yjs file entry
  let yjsEntry = $derived(entries.find(e => e.name === '.yjs'));

  // Load deltas from tree
  async function loadDeltas(): Promise<Uint8Array[]> {
    const tree = getTree();
    const deltasEntry = entries.find(e => e.name === 'deltas' && e.isTree);
    if (!deltasEntry) return [];

    try {
      const deltaEntries = await tree.listDirectory(deltasEntry.cid);
      // Sort by name (timestamp-based)
      const sorted = deltaEntries
        .filter(e => !e.isTree)
        .sort((a, b) => a.name.localeCompare(b.name));

      const deltas: Uint8Array[] = [];
      for (const entry of sorted) {
        const data = await tree.readFile(entry.cid);
        if (data) deltas.push(data);
      }
      return deltas;
    } catch {
      return [];
    }
  }

  // Save delta to tree
  async function saveDelta(update: Uint8Array): Promise<void> {
    const tree = getTree();
    let currentRootCid = getCurrentRootCid();
    if (!currentRootCid) {
      console.warn('[YjsDoc] No rootCid, cannot save');
      return;
    }

    saveStatus = 'saving';

    try {
      // Create timestamp-based filename
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).slice(2, 6);
      const deltaName = `${timestamp}-${random}`;

      // Get current path
      const currentPath = route.path;
      const deltasPath = [...currentPath, 'deltas'];

      // Check if deltas folder exists in current entries
      const deltasEntry = entries.find(e => e.name === 'deltas' && e.isTree);

      if (!deltasEntry) {
        // Create deltas folder first
        const { cid: emptyDirCid } = await tree.putDirectory([]);
        currentRootCid = await tree.setEntry(currentRootCid, currentPath, 'deltas', emptyDirCid, 0, true);
        // Publish intermediate update
        autosaveIfOwn(toHex(currentRootCid.hash), currentRootCid.key ? toHex(currentRootCid.key) : undefined);
      }

      // Write the delta file
      const { cid: deltaCid, size: deltaSize } = await tree.putFile(update);
      const newRootCid = await tree.setEntry(
        currentRootCid,
        deltasPath,
        deltaName,
        deltaCid,
        deltaSize,
        false
      );

      // Publish update
      autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
      saveStatus = 'saved';
      console.log('[YjsDoc] Saved delta:', deltaName);
    } catch (e) {
      console.error('[YjsDoc] Failed to save delta:', e);
      saveStatus = 'idle';
    }
  }

  // Debounced save
  function scheduleSave(update: Uint8Array) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDelta(update), 1000);
  }

  // Load editors from .yjs file
  async function loadEditors() {
    loadingEditors = true;
    if (!yjsEntry) {
      editors = [];
      loadingEditors = false;
      return;
    }

    try {
      const tree = getTree();
      const data = await tree.readFile(yjsEntry.cid);
      if (data) {
        const text = new TextDecoder().decode(data);
        editors = text.split('\n').filter(line => line.trim().startsWith('npub1'));
      } else {
        editors = [];
      }
    } catch (e) {
      console.error('[YjsDoc] Failed to load editors:', e);
      editors = [];
    }
    loadingEditors = false;
  }

  // Save editors to .yjs file
  async function saveEditors() {
    const tree = getTree();
    let currentRootCid = getCurrentRootCid();
    if (!currentRootCid) {
      console.warn('[YjsDoc] No rootCid, cannot save editors');
      return;
    }

    try {
      // Create .yjs content with editors (one npub per line)
      const content = editors.join('\n') + '\n';
      const data = new TextEncoder().encode(content);
      const { cid: yjsCid, size: yjsSize } = await tree.putFile(data);

      // Update .yjs file in tree
      const newRootCid = await tree.setEntry(
        currentRootCid,
        route.path,
        '.yjs',
        yjsCid,
        yjsSize,
        false
      );

      autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
      console.log('[YjsDoc] Saved editors:', editors.length);
    } catch (e) {
      console.error('[YjsDoc] Failed to save editors:', e);
    }
  }

  // Validate and add editor
  function addEditor() {
    addError = null;
    const npub = newEditorInput.trim();

    if (!npub.startsWith('npub1')) {
      addError = 'Invalid npub format';
      return;
    }

    // Validate npub can be decoded
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') {
        addError = 'Invalid npub format';
        return;
      }
    } catch {
      addError = 'Invalid npub';
      return;
    }

    if (editors.includes(npub)) {
      addError = 'Already an editor';
      return;
    }

    editors = [...editors, npub];
    newEditorInput = '';
    saveEditors();
  }

  // Remove editor
  function removeEditor(npub: string) {
    editors = editors.filter(e => e !== npub);
    saveEditors();
  }

  // Open editors modal
  function openEditorsModal() {
    loadEditors();
    showEditorsModal = true;
  }

  // Close editors modal
  function closeEditorsModal() {
    showEditorsModal = false;
    newEditorInput = '';
    addError = null;
  }

  // Handle escape key to close modal
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showEditorsModal) {
      closeEditorsModal();
    }
  }

  onMount(async () => {
    if (!editorElement) return;

    // Load editors for badge display
    loadEditors();

    // Create Yjs document
    ydoc = new Y.Doc();

    // Load existing deltas
    const deltas = await loadDeltas();
    for (const delta of deltas) {
      Y.applyUpdate(ydoc, delta);
    }

    // Create Tiptap editor with Yjs collaboration
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          history: false, // Yjs handles history
        }),
        Placeholder.configure({
          placeholder: 'Start typing...',
        }),
        Collaboration.configure({
          document: ydoc,
        }),
      ],
      editorProps: {
        attributes: {
          class: 'prose prose-invert max-w-none focus:outline-none min-h-[200px] p-4',
        },
      },
    });

    // Listen for updates and save
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') {
        scheduleSave(update);
      }
    });
  });

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    editor?.destroy();
    ydoc?.destroy();
  });
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="shrink-0 px-3 py-2 border-b border-surface-3 flex items-center justify-between bg-surface-1">
    <div class="flex items-center gap-2 min-w-0">
      <span class="i-lucide-file-text text-text-2 shrink-0"></span>
      <span class="font-medium text-text-1 truncate">{dirName}</span>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if saveStatus === 'saving'}
        <span class="text-text-3 text-sm">Saving...</span>
      {:else if saveStatus === 'saved'}
        <span class="text-success text-sm">Saved</span>
      {/if}
      <button
        onclick={openEditorsModal}
        class="btn-ghost"
        title={isOwner() ? 'Manage editors' : 'View editors'}
      >
        <span class="i-lucide-users text-text-2"></span>
        {#if editors.length > 0}
          <span class="text-xs bg-surface-3 px-1.5 py-0.5 rounded-full">{editors.length}</span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Editor area -->
  <div class="flex-1 overflow-auto">
    <div bind:this={editorElement} class="ProseMirror-container"></div>
  </div>

  <!-- Show file list below editor -->
  <div class="shrink-0 border-t border-surface-3 p-2">
    <div class="text-text-3 text-xs mb-1">Files in document:</div>
    <div class="flex flex-wrap gap-1">
      {#each entries as entry}
        <a
          href={`#/${route.npub}/${route.treeName}/${[...route.path, entry.name].map(encodeURIComponent).join('/')}${route.linkKey ? `?k=${route.linkKey}` : ''}`}
          class="text-xs px-2 py-1 rounded bg-surface-2 text-text-2 hover:bg-surface-3 no-underline"
        >
          {entry.name}
        </a>
      {/each}
    </div>
  </div>
</div>

<svelte:window onkeydown={handleKeydown} />

<!-- Editors Modal -->
{#if showEditorsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={closeEditorsModal}>
    <div class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold mb-4">{isOwner() ? 'Manage Editors' : 'Editors'}</h2>

      {#if loadingEditors}
        <p class="text-text-3">Loading editors...</p>
      {:else}
        <!-- Current editors list -->
        <ul class="space-y-2 mb-4 max-h-48 overflow-auto list-none m-0 p-0">
          {#if editors.length === 0}
            <li class="text-text-3 text-sm">No editors added yet</li>
          {:else}
            {#each editors as npub}
              <li class="flex items-center justify-between gap-2 p-2 bg-surface-2 rounded">
                <span class="text-sm truncate flex-1">{npub.slice(0, 20)}...</span>
                {#if isOwner()}
                  <button
                    onclick={() => removeEditor(npub)}
                    class="btn-ghost text-danger text-sm"
                    title="Remove editor"
                  >
                    <span class="i-lucide-x"></span>
                  </button>
                {/if}
              </li>
            {/each}
          {/if}
        </ul>

        <!-- Add new editor (only for owner) -->
        {#if isOwner()}
          <div class="border-t border-surface-3 pt-4">
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={newEditorInput}
                placeholder="npub1..."
                class="input flex-1"
                onkeypress={(e) => e.key === 'Enter' && addEditor()}
              />
              <button
                onclick={addEditor}
                class="btn-success"
                disabled={!newEditorInput.trim()}
              >
                Add User
              </button>
            </div>
            {#if addError}
              <p class="text-danger text-sm mt-2">{addError}</p>
            {/if}
          </div>
        {/if}
      {/if}

      <div class="flex justify-end mt-4">
        <button onclick={closeEditorsModal} class="btn-ghost">Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.ProseMirror-container .ProseMirror) {
    min-height: 200px;
    padding: 1rem;
  }
  :global(.ProseMirror-container .ProseMirror:focus) {
    outline: none;
  }
  :global(.ProseMirror-container .ProseMirror p.is-editor-empty:first-child::before) {
    color: var(--color-text-3);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
