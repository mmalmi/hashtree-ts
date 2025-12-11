<script lang="ts">
  /**
   * Yjs Document Editor - Tiptap-based collaborative editor
   * Shows when a directory contains a .yjs file
   *
   * When collaborators are defined, this component will also fetch and merge
   * deltas from those users' hashtrees at the same relative path.
   */
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import * as Y from 'yjs';
  import Collaboration from '@tiptap/extension-collaboration';
  import { toHex, LinkType } from 'hashtree';
  import type { CID, TreeEntry } from 'hashtree';
  import { getTree, decodeAsText } from '../../store';
  import { routeStore, createTreesStore, getTreeRootSync } from '../../stores';
  import { openShareModal, openForkModal, openCollaboratorsModal } from '../../stores/modals';
  import { autosaveIfOwn, useNostrStore } from '../../nostr';
  import { updateLocalRootCacheHex } from '../../treeRootCache';
  import { getCurrentRootCid, deleteCurrentFolder } from '../../actions';
  import { getRefResolver } from '../../refResolver';
  import { nip19 } from 'nostr-tools';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar } from '../User';
  import { npubToPubkey } from '../../nostr';

  const DELTAS_DIR = 'deltas';
  const STATE_FILE = 'state.yjs';

  interface Props {
    dirCid: CID;
    dirName: string;
    entries: TreeEntry[];
  }

  let { dirCid, dirName, entries }: Props = $props();

  let route = $derived($routeStore);
  let nostrState = $derived(useNostrStore.getState());
  let userNpub = $derived(nostrState.npub);
  let viewedNpub = $derived(route.npub);
  let editorElement: HTMLElement | undefined = $state();
  let editor: Editor | undefined = $state();
  let ydoc: Y.Doc | undefined = $state();
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  let lastSaved = $state<Date | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let loading = $state(true);

  // Collaborators list
  let collaborators = $state<string[]>([]);

  // Check if current user is owner of this tree
  let isOwnTree = $derived(!viewedNpub || viewedNpub === userNpub);

  // Check if user is listed as an editor
  let isEditor = $derived(userNpub ? collaborators.includes(userNpub) : false);

  // Can edit if own tree or editor
  let canEdit = $derived(isOwnTree || isEditor);

  // Get owner pubkey for avatar display
  let ownerNpub = $derived(viewedNpub || userNpub);
  let ownerPubkey = $derived(ownerNpub ? npubToPubkey(ownerNpub) : null);

  // Get trees for visibility info
  let targetNpub = $derived(viewedNpub || userNpub);
  let treesStore = $derived(createTreesStore(targetNpub));
  let trees = $state<Array<{ name: string; visibility?: string }>>([]);

  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  let currentTree = $derived(route.treeName ? trees.find(t => t.name === route.treeName) : null);
  let visibility = $derived(currentTree?.visibility || 'public');

  // Find the .yjs file entry
  let yjsEntry = $derived(entries.find(e => e.name === '.yjs'));

  // Track previous collaborators to detect changes
  let prevCollaboratorsKey = '';

  // Reactively update subscriptions when collaborators change
  $effect(() => {
    const currentKey = collaborators.join(',');
    if (currentKey !== prevCollaboratorsKey && ydoc && collaborators.length > 0) {
      prevCollaboratorsKey = currentKey;
      setupCollaboratorSubscriptions(collaborators);
    }
  });

  // Reactively update editor's editable state when canEdit changes
  $effect(() => {
    if (editor && editor.isEditable !== canEdit) {
      editor.setEditable(canEdit);
    }
  });

  // Load deltas from a directory's entries
  async function loadDeltasFromEntries(docEntries: TreeEntry[]): Promise<Uint8Array[]> {
    const tree = getTree();
    const deltas: Uint8Array[] = [];

    // Load state.yjs if exists
    const stateEntry = docEntries.find(e => e.name === STATE_FILE && e.type !== LinkType.Dir);
    if (stateEntry) {
      const data = await tree.readFile(stateEntry.cid);
      if (data) deltas.push(data);
    }

    // Load deltas from deltas/ directory
    const deltasEntry = docEntries.find(e => e.name === DELTAS_DIR && e.type === LinkType.Dir);
    if (deltasEntry) {
      try {
        const deltaEntries = await tree.listDirectory(deltasEntry.cid);
        // Sort by name (timestamp-based or numeric)
        const sorted = deltaEntries
          .filter(e => e.type !== LinkType.Dir)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        for (const entry of sorted) {
          const data = await tree.readFile(entry.cid);
          if (data) deltas.push(data);
        }
      } catch (err) {
        console.error(`[YjsDoc] loadDeltasFromEntries error:`, err);
      }
    }

    return deltas;
  }

  // Load deltas from all collaborators' trees
  async function loadCollaboratorDeltas(collaboratorNpubs: string[]): Promise<void> {
    const tree = getTree();
    const resolver = getRefResolver();
    const docPath = route.path.join('/');
    const treeName = route.treeName;

    if (!treeName) return;

    // Filter out the currently viewed tree's npub (we already loaded local deltas)
    const otherEditors = collaboratorNpubs.filter(npub => npub !== route.npub);

    for (const npub of otherEditors) {
      try {
        // Resolve the editor's tree root via subscription
        const resolverKey = `${npub}/${treeName}`;
        const rootCid = await new Promise<CID | null>((resolve) => {
          let hasResolved = false;
          let unsub: (() => void) | null = null;

          const cleanup = () => {
            if (unsub) unsub();
          };

          unsub = resolver.subscribe(resolverKey, (cidObj) => {
            if (hasResolved) return;
            hasResolved = true;
            // Defer cleanup to avoid referencing unsub before assignment
            queueMicrotask(cleanup);
            resolve(cidObj);
          });

          // Timeout after 5 seconds
          setTimeout(() => {
            if (!hasResolved) {
              hasResolved = true;
              cleanup();
              resolve(null);
            }
          }, 5000);
        });

        if (!rootCid) continue;

        // Resolve the path to the document directory in their tree
        const result = await tree.resolvePath(rootCid, docPath);
        if (!result) continue;

        // Check if it's a directory
        const isDir = await tree.isDirectory(result.cid);
        if (!isDir) continue;

        // List entries in their document directory
        const collabEntries = await tree.listDirectory(result.cid);

        // Load and apply their deltas
        const collabDeltas = await loadDeltasFromEntries(collabEntries);
        for (const delta of collabDeltas) {
          if (ydoc) Y.applyUpdate(ydoc, delta, 'remote');
        }

      } catch (err) {
        console.warn(`[YjsDoc] Failed to load deltas from collaborator ${npub}:`, err);
      }
    }
  }

  // Subscription cleanup functions
  let collabUnsubscribes: (() => void)[] = [];

  // Subscribe to collaborators' trees for live updates
  function setupCollaboratorSubscriptions(collaboratorNpubs: string[]) {
    // Clean up existing subscriptions
    collabUnsubscribes.forEach(unsub => unsub());
    collabUnsubscribes = [];

    if (collaboratorNpubs.length === 0 || !route.treeName) return;

    const resolver = getRefResolver();
    const tree = getTree();
    const docPath = route.path.join('/');
    const docOwnerNpub = viewedNpub || userNpub;


    // Subscribe to all editors' trees (including our own for multi-tab sync)
    for (const npub of collaboratorNpubs) {
      const resolverKey = `${npub}/${route.treeName}`;

      // Track last seen hash to detect actual changes
      let lastSeenHash: string | null = null;

      const unsub = resolver.subscribe(resolverKey, async (cidObj) => {
        const newHash = cidObj ? toHex(cidObj.hash) : null;
        const isNewUpdate = newHash !== lastSeenHash;
        lastSeenHash = newHash;
        if (!cidObj || !ydoc) {
          return;
        }

        try {
          // Fetch and apply deltas from this editor
          const rootCid = cidObj;
          const result = await tree.resolvePath(rootCid, docPath);
          if (!result) {
            return;
          }

          const isDir = await tree.isDirectory(result.cid);
          if (!isDir) {
            return;
          }

          const collabEntries = await tree.listDirectory(result.cid);

          // If this update is from the document owner, re-read .yjs to check for collaborator changes
          if (npub === docOwnerNpub) {
            const yjsConfigEntry = collabEntries.find(e => e.name === '.yjs' && e.type !== LinkType.Dir);
            if (yjsConfigEntry) {
              const data = await tree.readFile(yjsConfigEntry.cid);
              if (data) {
                const text = decodeAsText(data);
                if (text) {
                  const newCollaborators = text.split('\n').filter(line => line.trim().startsWith('npub1'));
                  // Update if changed
                  if (JSON.stringify(newCollaborators) !== JSON.stringify(collaborators)) {
                    collaborators = newCollaborators;
                  }
                }
              }
            }
          }

          // Load and apply deltas
          const collabDeltas = await loadDeltasFromEntries(collabEntries);
          for (const delta of collabDeltas) {
            Y.applyUpdate(ydoc, delta, 'remote');
          }

        } catch (err) {
          console.warn(`[YjsDoc] Failed to fetch updates from editor ${npub}:`, err);
        }
      });

      collabUnsubscribes.push(unsub);
    }
  }

  // Save state snapshot to tree (full document state)
  // When editing another user's document, saves to OUR tree at the same path
  async function saveStateSnapshot(): Promise<void> {
    const tree = getTree();
    if (!ydoc || !userNpub || !route.treeName) {
      console.warn('[YjsDoc] Missing ydoc, userNpub, or treeName, cannot save');
      return;
    }


    // Always save to OUR OWN tree, even when viewing someone else's document
    // This way our edits are published to our tree and synced via subscriptions
    let rootCid = getTreeRootSync(userNpub, route.treeName);

    // If we don't have our own tree yet, we need to create one
    if (!rootCid) {
      const { cid: emptyDirCid } = await tree.putDirectory([]);
      rootCid = emptyDirCid;
    }

    saveStatus = 'saving';

    try {
      // Encode full state snapshot (not just incremental delta)
      const stateUpdate = Y.encodeStateAsUpdate(ydoc);

      // Create timestamp-based filename
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).slice(2, 6);
      const deltaName = `${timestamp}-${random}`;

      // Get current path - this is the document path we're editing
      const currentPath = route.path;
      const deltasPath = [...currentPath, 'deltas'];

      // Ensure path exists in our tree - create directories as needed
      // E.g., if path is ['public', 'collab-doc'], we need to ensure 'public' dir exists first
      for (let i = 0; i < currentPath.length; i++) {
        const parentPath = currentPath.slice(0, i);
        const dirName = currentPath[i];
        const fullPath = currentPath.slice(0, i + 1).join('/');

        const pathExists = await tree.resolvePath(rootCid, fullPath);
        if (!pathExists) {
          const { cid: emptyDirCid } = await tree.putDirectory([]);
          rootCid = await tree.setEntry(rootCid, parentPath, dirName, emptyDirCid, 0, true);
        }
      }

      // Check if document folder has .yjs file
      const docResult = await tree.resolvePath(rootCid, currentPath.join('/'));
      if (docResult) {
        const docEntries = await tree.listDirectory(docResult.cid);
        const hasYjsFile = docEntries.some(e => e.name === '.yjs' && e.type !== LinkType.Dir);

        if (!hasYjsFile) {
          // Create .yjs file with collaborators
          const yjsContent = collaborators.join('\n') + '\n';
          const yjsData = new TextEncoder().encode(yjsContent);
          const { cid: yjsCid, size: yjsSize } = await tree.putFile(yjsData);
          rootCid = await tree.setEntry(rootCid, currentPath, '.yjs', yjsCid, yjsSize, false);
        }
      }

      // Check if deltas folder exists
      const deltasResult = await tree.resolvePath(rootCid, deltasPath.join('/'));
      if (!deltasResult) {
        // Create deltas folder
        const { cid: emptyDirCid } = await tree.putDirectory([]);
        rootCid = await tree.setEntry(rootCid, currentPath, 'deltas', emptyDirCid, 0, true);
      }

      // Write the state snapshot file
      const { cid: deltaCid, size: deltaSize } = await tree.putFile(stateUpdate);
      const newRootCid = await tree.setEntry(
        rootCid,
        deltasPath,
        deltaName,
        deltaCid,
        deltaSize,
        false
      );

      // Publish update
      if (isOwnTree) {
        // Own tree - use autosaveIfOwn which handles visibility settings
        autosaveIfOwn(newRootCid);
      } else {
        // Editing someone else's document - save to our own tree
        // Use updateLocalRootCacheHex which triggers throttled publish to Nostr
        updateLocalRootCacheHex(
          userNpub,
          route.treeName!,
          toHex(newRootCid.hash),
          newRootCid.key ? toHex(newRootCid.key) : undefined
        );
      }

      saveStatus = 'saved';
      lastSaved = new Date();
    } catch (e) {
      console.error('[YjsDoc] Failed to save state snapshot:', e);
      saveStatus = 'error';
    }
  }

  // Debounced save - saves full state snapshot (not incremental delta)
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveStateSnapshot(), 1000);
  }

  // Load editors from .yjs file
  async function loadEditors() {
    if (yjsEntry) {
    }

    if (!yjsEntry) {
      collaborators = [];
      return;
    }

    try {
      const tree = getTree();
      const data = await tree.readFile(yjsEntry.cid);
      if (data) {
        const text = new TextDecoder().decode(data);
        collaborators = text.split('\n').filter(line => line.trim().startsWith('npub1'));
      } else {
        collaborators = [];
      }
    } catch (e) {
      console.error('[YjsDoc] Failed to load editors:', e);
      collaborators = [];
    }
  }

  // Save editors to .yjs file
  async function saveCollaborators(npubs: string[]) {
    const tree = getTree();
    let currentRootCid = getCurrentRootCid();
    if (!currentRootCid) {
      console.warn('[YjsDoc] No rootCid, cannot save editors');
      return;
    }

    try {
      // Create .yjs content with editors (one npub per line)
      const content = npubs.join('\n') + '\n';
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

      autosaveIfOwn(newRootCid);
      collaborators = npubs;
    } catch (e) {
      console.error('[YjsDoc] Failed to save editors:', e);
    }
  }

  // Handle share
  function handleShare() {
    openShareModal(window.location.href);
  }

  // Handle fork
  function handleFork() {
    if (!dirCid) return;
    openForkModal(dirCid, dirName);
  }

  // Handle collaborators
  function handleCollaborators() {
    if (isOwnTree) {
      openCollaboratorsModal(collaborators, saveCollaborators);
    } else {
      openCollaboratorsModal(collaborators);
    }
  }

  // Handle delete
  function handleDelete() {
    if (confirm(`Delete document "${dirName}" and all its contents?`)) {
      deleteCurrentFolder();
    }
  }

  onMount(async () => {
    if (!editorElement) return;

    // Load editors
    await loadEditors();

    // Create Yjs document
    ydoc = new Y.Doc();

    // Load existing deltas from current view's entries
    const localDeltas = await loadDeltasFromEntries(entries);
    for (const delta of localDeltas) {
      Y.applyUpdate(ydoc, delta, 'remote');
    }

    // Load deltas from collaborators' trees
    if (collaborators.length > 0) {
      await loadCollaboratorDeltas(collaborators);
    }

    loading = false;

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
      editable: canEdit,
      editorProps: {
        attributes: {
          class: 'prose prose-invert max-w-none focus:outline-none min-h-[200px] p-4',
        },
      },
    });

    // Set up live subscriptions to collaborators' trees
    if (collaborators.length > 0) {
      setupCollaboratorSubscriptions(collaborators);
    } else {
    }

    // Listen for updates and save (full state snapshot, not incremental delta)
    ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && canEdit) {
        scheduleSave();
      }
    });
  });

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    // Clean up collaborator subscriptions
    collabUnsubscribes.forEach(unsub => unsub());
    collabUnsubscribes = [];
    editor?.destroy();
    ydoc?.destroy();
  });

  // Formatting toolbar actions
  function toggleBold() { editor?.chain().focus().toggleBold().run(); }
  function toggleItalic() { editor?.chain().focus().toggleItalic().run(); }
  function toggleStrike() { editor?.chain().focus().toggleStrike().run(); }
  function toggleCode() { editor?.chain().focus().toggleCode().run(); }
  function toggleHeading1() { editor?.chain().focus().toggleHeading({ level: 1 }).run(); }
  function toggleHeading2() { editor?.chain().focus().toggleHeading({ level: 2 }).run(); }
  function toggleHeading3() { editor?.chain().focus().toggleHeading({ level: 3 }).run(); }
  function toggleBulletList() { editor?.chain().focus().toggleBulletList().run(); }
  function toggleOrderedList() { editor?.chain().focus().toggleOrderedList().run(); }
  function toggleBlockquote() { editor?.chain().focus().toggleBlockquote().run(); }
  function toggleCodeBlock() { editor?.chain().focus().toggleCodeBlock().run(); }
  function insertHorizontalRule() { editor?.chain().focus().setHorizontalRule().run(); }
  function undo() { editor?.chain().focus().undo().run(); }
  function redo() { editor?.chain().focus().redo().run(); }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Status bar -->
  <div class="shrink-0 px-4 py-2 border-b border-surface-3 flex flex-wrap items-center justify-between gap-2 bg-surface-1 text-sm">
    <div class="flex items-center gap-2 min-w-0">
      {#if ownerPubkey}
        <Avatar pubkey={ownerPubkey} size={20} />
      {/if}
      <span class="i-lucide-file-text text-text-2 shrink-0"></span>
      <span class="font-medium text-text-1 truncate">{dirName}</span>
      <VisibilityIcon {visibility} class="text-text-2 text-sm" />
      {#if canEdit}
        <span class="i-lucide-pencil text-xs text-text-3" title={isOwnTree ? "You can edit this document" : "Editing as editor - saves to your tree"}></span>
      {/if}
      {#if !canEdit}
        <span class="text-xs px-2 py-0.5 rounded bg-surface-2 text-text-3">Read-only</span>
      {/if}
      {#if isEditor && !isOwnTree}
        <span class="text-xs px-2 py-0.5 rounded bg-success/20 text-success" title="You are an editor - edits save to your tree">Editor</span>
      {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <!-- Save status -->
      <div class="flex items-center gap-2 text-text-3">
        {#if saveStatus === 'saving'}
          <span class="i-lucide-loader-2 animate-spin"></span>
          <span>Saving...</span>
        {:else if lastSaved}
          <span class="text-xs">Saved {lastSaved.toLocaleTimeString()}</span>
        {/if}
      </div>
      <!-- Share button -->
      <button onclick={handleShare} class="btn-ghost" title="Share document">
        <span class="i-lucide-share"></span>
      </button>
      <!-- Collaborators button -->
      <button onclick={handleCollaborators} class="btn-ghost flex items-center gap-1" title={isOwnTree ? 'Manage editors' : 'View editors'}>
        <span class="i-lucide-users"></span>
        {#if collaborators.length > 0}
          <span class="text-xs bg-surface-2 px-1.5 rounded-full">{collaborators.length}</span>
        {/if}
      </button>
      <!-- Fork button -->
      <button onclick={handleFork} class="btn-ghost flex items-center gap-1" title="Fork document as new tree">
        <span class="i-lucide-git-fork"></span>
        Fork
      </button>
      <!-- Delete button - only for own tree -->
      {#if isOwnTree}
        <button onclick={handleDelete} class="btn-ghost text-danger" title="Delete document">
          Delete
        </button>
      {/if}
    </div>
  </div>

  <!-- Formatting Toolbar -->
  {#if canEdit && editor && !loading}
    <div class="flex items-center gap-1 px-4 py-2 border-b border-surface-3 bg-surface-1 shrink-0 flex-wrap">
      <!-- Text formatting -->
      <button
        onclick={toggleBold}
        class="btn-ghost p-1.5 {editor.isActive('bold') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Bold (Ctrl+B)"
      >
        <span class="i-lucide-bold text-sm"></span>
      </button>
      <button
        onclick={toggleItalic}
        class="btn-ghost p-1.5 {editor.isActive('italic') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Italic (Ctrl+I)"
      >
        <span class="i-lucide-italic text-sm"></span>
      </button>
      <button
        onclick={toggleStrike}
        class="btn-ghost p-1.5 {editor.isActive('strike') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Strikethrough"
      >
        <span class="i-lucide-strikethrough text-sm"></span>
      </button>
      <button
        onclick={toggleCode}
        class="btn-ghost p-1.5 {editor.isActive('code') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Inline Code"
      >
        <span class="i-lucide-code text-sm"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Headings -->
      <button
        onclick={toggleHeading1}
        class="btn-ghost p-1.5 {editor.isActive('heading', { level: 1 }) ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Heading 1"
      >
        <span class="i-lucide-heading-1 text-sm"></span>
      </button>
      <button
        onclick={toggleHeading2}
        class="btn-ghost p-1.5 {editor.isActive('heading', { level: 2 }) ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Heading 2"
      >
        <span class="i-lucide-heading-2 text-sm"></span>
      </button>
      <button
        onclick={toggleHeading3}
        class="btn-ghost p-1.5 {editor.isActive('heading', { level: 3 }) ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Heading 3"
      >
        <span class="i-lucide-heading-3 text-sm"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Lists -->
      <button
        onclick={toggleBulletList}
        class="btn-ghost p-1.5 {editor.isActive('bulletList') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Bullet List"
      >
        <span class="i-lucide-list text-sm"></span>
      </button>
      <button
        onclick={toggleOrderedList}
        class="btn-ghost p-1.5 {editor.isActive('orderedList') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Numbered List"
      >
        <span class="i-lucide-list-ordered text-sm"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Block elements -->
      <button
        onclick={toggleBlockquote}
        class="btn-ghost p-1.5 {editor.isActive('blockquote') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Quote"
      >
        <span class="i-lucide-quote text-sm"></span>
      </button>
      <button
        onclick={toggleCodeBlock}
        class="btn-ghost p-1.5 {editor.isActive('codeBlock') ? 'bg-surface-3 text-text-1' : 'text-text-3'}"
        title="Code Block"
      >
        <span class="i-lucide-file-code text-sm"></span>
      </button>
      <button
        onclick={insertHorizontalRule}
        class="btn-ghost p-1.5 text-text-3"
        title="Horizontal Rule"
      >
        <span class="i-lucide-minus text-sm"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Undo/Redo -->
      <button
        onclick={undo}
        disabled={!editor.can().undo()}
        class="btn-ghost p-1.5 text-text-3 disabled:opacity-30"
        title="Undo (Ctrl+Z)"
      >
        <span class="i-lucide-undo text-sm"></span>
      </button>
      <button
        onclick={redo}
        disabled={!editor.can().redo()}
        class="btn-ghost p-1.5 text-text-3 disabled:opacity-30"
        title="Redo (Ctrl+Shift+Z)"
      >
        <span class="i-lucide-redo text-sm"></span>
      </button>
    </div>
  {/if}

  <!-- Editor area - always render the container, just hide content while loading -->
  <div class="flex-1 overflow-auto {loading ? 'hidden' : ''}">
    <div bind:this={editorElement} class="ProseMirror-container prose prose-sm max-w-none min-h-full"></div>
  </div>

  <!-- Loading state -->
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-text-3">
      <span class="i-lucide-loader-2 animate-spin mr-2"></span>
      Loading document...
    </div>
  {/if}
</div>

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
