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
  import Image from '@tiptap/extension-image';
  import * as Y from 'yjs';
  import Collaboration from '@tiptap/extension-collaboration';
  import { toHex, LinkType } from 'hashtree';
  import type { CID, TreeEntry } from 'hashtree';
  import { getTree, decodeAsText } from '../../store';
  import { routeStore, createTreesStore, getTreeRootSync } from '../../stores';
  import { openShareModal, openForkModal, openCollaboratorsModal, updateCollaboratorsModal, openBlossomPushModal } from '../../stores/modals';
  import { autosaveIfOwn, nostrStore, npubToPubkey } from '../../nostr';
  import { updateLocalRootCacheHex } from '../../treeRootCache';
  import { getCurrentRootCid, deleteCurrentFolder } from '../../actions';
  import { getRefResolver } from '../../refResolver';
  import { nip19 } from 'nostr-tools';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar } from '../User';

  const DELTAS_DIR = 'deltas';
  const STATE_FILE = 'state.yjs';
  const ATTACHMENTS_DIR = 'attachments';

  interface Props {
    dirCid: CID;
    dirName: string;
    entries: TreeEntry[];
  }

  let { dirCid, dirName, entries }: Props = $props();

  let route = $derived($routeStore);
  let userNpub = $derived($nostrStore.npub);
  let viewedNpub = $derived(route.npub);
  let editorElement: HTMLElement | undefined = $state();
  let editor: Editor | undefined = $state();
  let ydoc: Y.Doc | undefined = $state();
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  let lastSaved = $state<Date | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let loading = $state(true);
  let imageFileInput: HTMLInputElement | undefined = $state();

  // Map of image names to blob URLs for display
  let imageUrlCache = new Map<string, string>();

  // Collaborators list
  let collaborators = $state<string[]>([]);

  // Check if current user is owner of this tree
  let isOwnTree = $derived(!viewedNpub || viewedNpub === userNpub);

  // Check if user is listed as an editor
  let isEditor = $derived(userNpub ? collaborators.includes(userNpub) : false);

  // Keep collaborators modal in sync when collaborators change
  $effect(() => {
    updateCollaboratorsModal(collaborators);
  });

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

  // Generate a unique filename for an image
  function generateImageFilename(file: File): string {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    return `${timestamp}-${random}.${ext}`;
  }

  // Get blob URL for an image (from cache or load from tree)
  async function getImageUrl(imageName: string): Promise<string | null> {
    // Check cache first
    if (imageUrlCache.has(imageName)) {
      return imageUrlCache.get(imageName)!;
    }

    // Load from tree
    const tree = getTree();
    const currentPath = route.path;
    const attachmentsPath = [...currentPath, ATTACHMENTS_DIR, imageName].join('/');

    // Use the viewed tree's root or our own
    let rootCid: CID | null = null;
    if (viewedNpub) {
      rootCid = route.treeName ? getTreeRootSync(viewedNpub, route.treeName) : null;
    } else if (userNpub && route.treeName) {
      rootCid = getTreeRootSync(userNpub, route.treeName);
    }

    if (!rootCid) return null;

    try {
      const result = await tree.resolvePath(rootCid, attachmentsPath);
      if (!result) return null;

      const data = await tree.readFile(result.cid);
      if (!data) return null;

      // Determine MIME type from extension
      const ext = imageName.split('.').pop()?.toLowerCase() || '';
      const mimeTypes: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'avif': 'image/avif',
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      const blob = new Blob([data.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      imageUrlCache.set(imageName, url);
      return url;
    } catch (err) {
      console.error(`[YjsDoc] Failed to load image ${imageName}:`, err);
      return null;
    }
  }

  // Save image to attachments/ directory
  async function saveImage(data: Uint8Array, filename: string): Promise<string | null> {
    const tree = getTree();
    if (!userNpub || !route.treeName) {
      console.warn('[YjsDoc] Missing userNpub or treeName, cannot save image');
      return null;
    }

    // Always save to our own tree
    let rootCid = getTreeRootSync(userNpub, route.treeName);
    if (!rootCid) {
      const { cid: emptyDirCid } = await tree.putDirectory([]);
      rootCid = emptyDirCid;
    }

    try {
      const currentPath = route.path;
      const attachmentsPath = [...currentPath, ATTACHMENTS_DIR];

      // Ensure attachments directory exists
      const attachmentsResult = await tree.resolvePath(rootCid, attachmentsPath.join('/'));
      if (!attachmentsResult) {
        // Create attachments directory
        const { cid: emptyDirCid } = await tree.putDirectory([]);
        rootCid = await tree.setEntry(rootCid, currentPath, ATTACHMENTS_DIR, emptyDirCid, 0, LinkType.Dir);
      }

      // Save the image file
      const { cid: imageCid, size: imageSize } = await tree.putFile(data);
      const newRootCid = await tree.setEntry(
        rootCid,
        attachmentsPath,
        filename,
        imageCid,
        imageSize,
        LinkType.Blob
      );

      // Publish update
      if (isOwnTree) {
        autosaveIfOwn(newRootCid);
      } else {
        updateLocalRootCacheHex(
          userNpub,
          route.treeName!,
          toHex(newRootCid.hash),
          newRootCid.key ? toHex(newRootCid.key) : undefined
        );
      }

      // Cache the blob URL
      const ext = filename.split('.').pop()?.toLowerCase() || 'png';
      const mimeTypes: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'avif': 'image/avif',
      };
      const mimeType = mimeTypes[ext] || 'image/png';
      const blob = new Blob([data.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      imageUrlCache.set(filename, url);

      return filename;
    } catch (err) {
      console.error('[YjsDoc] Failed to save image:', err);
      return null;
    }
  }

  // Handle image upload from file input, paste, or drop
  async function handleImageUpload(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) return;

    const data = new Uint8Array(await file.arrayBuffer());
    const filename = generateImageFilename(file);

    const savedFilename = await saveImage(data, filename);
    if (savedFilename && editor) {
      // Insert image into editor with a special src that we'll resolve
      // Use attachments:filename format to indicate it's a local attachment
      editor.chain().focus().setImage({ src: `attachments:${savedFilename}` }).run();
    }
  }

  // Handle paste event for images
  function handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageUpload(file);
        return;
      }
    }
  }

  // Handle drop event for images
  function handleDrop(event: DragEvent): void {
    const files = event.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        event.preventDefault();
        handleImageUpload(file);
        return;
      }
    }
  }

  // Trigger file input for image upload
  function triggerImageUpload(): void {
    imageFileInput?.click();
  }

  // Handle file input change
  function handleFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      handleImageUpload(file);
      input.value = ''; // Reset for next upload
    }
  }

  // Load and resolve all images in document content
  async function loadDocumentImages(): Promise<void> {
    const tree = getTree();
    const currentPath = route.path;
    const attachmentsPath = [...currentPath, ATTACHMENTS_DIR].join('/');

    // Get root CID
    let rootCid: CID | null = null;
    if (viewedNpub) {
      rootCid = route.treeName ? getTreeRootSync(viewedNpub, route.treeName) : null;
    } else if (userNpub && route.treeName) {
      rootCid = getTreeRootSync(userNpub, route.treeName);
    }

    if (!rootCid) return;

    try {
      const result = await tree.resolvePath(rootCid, attachmentsPath);
      if (!result) return;

      const isDir = await tree.isDirectory(result.cid);
      if (!isDir) return;

      const attachmentEntries = await tree.listDirectory(result.cid);

      // Pre-load all images into cache
      for (const entry of attachmentEntries) {
        if (entry.type !== LinkType.Dir) {
          await getImageUrl(entry.name);
        }
      }
    } catch (err) {
      // Attachments directory doesn't exist yet, that's fine
    }
  }

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

    // Subscribe to collaborators' trees, but NOT our own tree
    // Our own updates are already in local state - re-applying them causes focus loss
    const otherCollaborators = collaboratorNpubs.filter(npub => npub !== userNpub);

    for (const npub of otherCollaborators) {
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
          rootCid = await tree.setEntry(rootCid, parentPath, dirName, emptyDirCid, 0, LinkType.Dir);
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
          rootCid = await tree.setEntry(rootCid, currentPath, '.yjs', yjsCid, yjsSize, LinkType.Blob);
        }
      }

      // Check if deltas folder exists
      const deltasResult = await tree.resolvePath(rootCid, deltasPath.join('/'));
      if (!deltasResult) {
        // Create deltas folder
        const { cid: emptyDirCid } = await tree.putDirectory([]);
        rootCid = await tree.setEntry(rootCid, currentPath, 'deltas', emptyDirCid, 0, LinkType.Dir);
      }

      // Write the state snapshot file
      const { cid: deltaCid, size: deltaSize } = await tree.putFile(stateUpdate);
      const newRootCid = await tree.setEntry(
        rootCid,
        deltasPath,
        deltaName,
        deltaCid,
        deltaSize,
        LinkType.Blob
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

    // Load images from attachments directory
    await loadDocumentImages();

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

    // Create Tiptap editor with Yjs collaboration and image support
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
        Image.configure({
          inline: false,
          allowBase64: false,
        }),
      ],
      editable: canEdit,
      editorProps: {
        attributes: {
          class: 'prose prose-invert max-w-none focus:outline-none min-h-[200px] p-4',
        },
        handlePaste: (view, event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;

          for (const item of items) {
            if (item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) handleImageUpload(file);
              return true;
            }
          }
          return false;
        },
        handleDrop: (view, event, slice, moved) => {
          if (moved) return false;

          const files = event.dataTransfer?.files;
          if (!files) return false;

          for (const file of files) {
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              handleImageUpload(file);
              return true;
            }
          }
          return false;
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
      if (origin !== 'remote') {
        scheduleSave();
      }
    });

    // Set up image URL resolution for attachments:* sources
    // Use MutationObserver to watch for new images and resolve their sources
    const observer = new MutationObserver(async (mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLImageElement) {
            await resolveImageSrc(node);
          } else if (node instanceof HTMLElement) {
            const images = node.querySelectorAll('img');
            for (const img of images) {
              await resolveImageSrc(img);
            }
          }
        }
      }
    });

    observer.observe(editorElement, { childList: true, subtree: true });

    // Resolve existing images
    const existingImages = editorElement.querySelectorAll('img');
    for (const img of existingImages) {
      await resolveImageSrc(img);
    }

    // Cleanup observer on destroy
    const originalDestroy = editor.destroy.bind(editor);
    editor.destroy = () => {
      observer.disconnect();
      originalDestroy();
    };
  });

  // Resolve image src from attachments:filename to blob URL
  async function resolveImageSrc(img: HTMLImageElement): Promise<void> {
    const src = img.getAttribute('src');
    if (!src || !src.startsWith('attachments:')) return;

    const filename = src.replace('attachments:', '');
    const url = await getImageUrl(filename);
    if (url) {
      img.src = url;
    }
  }

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    // Clean up collaborator subscriptions
    collabUnsubscribes.forEach(unsub => unsub());
    collabUnsubscribes = [];
    // Clean up image blob URLs
    for (const url of imageUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    imageUrlCache.clear();
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
      <a href="#/" class="btn-ghost p-1" title="Back to home">
        <span class="i-lucide-chevron-left text-lg"></span>
      </a>
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
      <button onclick={() => openBlossomPushModal(dirCid, dirName, true)} class="btn-ghost" title="Push to file servers">
        <span class="i-lucide-upload-cloud"></span>
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
    <div class="flex items-center justify-center gap-1 px-4 py-2 border-b border-surface-3 bg-surface-1 shrink-0 flex-wrap">
      <!-- Text formatting -->
      <button
        onclick={toggleBold}
        class="toolbar-btn {editor.isActive('bold') ? 'active' : ''}"
        title="Bold (Ctrl+B)"
      >
        <span class="i-lucide-bold"></span>
      </button>
      <button
        onclick={toggleItalic}
        class="toolbar-btn {editor.isActive('italic') ? 'active' : ''}"
        title="Italic (Ctrl+I)"
      >
        <span class="i-lucide-italic"></span>
      </button>
      <button
        onclick={toggleStrike}
        class="toolbar-btn {editor.isActive('strike') ? 'active' : ''}"
        title="Strikethrough"
      >
        <span class="i-lucide-strikethrough"></span>
      </button>
      <button
        onclick={toggleCode}
        class="toolbar-btn {editor.isActive('code') ? 'active' : ''}"
        title="Inline Code"
      >
        <span class="i-lucide-code"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Headings -->
      <button
        onclick={toggleHeading1}
        class="toolbar-btn {editor.isActive('heading', { level: 1 }) ? 'active' : ''}"
        title="Heading 1"
      >
        <span class="i-lucide-heading-1"></span>
      </button>
      <button
        onclick={toggleHeading2}
        class="toolbar-btn {editor.isActive('heading', { level: 2 }) ? 'active' : ''}"
        title="Heading 2"
      >
        <span class="i-lucide-heading-2"></span>
      </button>
      <button
        onclick={toggleHeading3}
        class="toolbar-btn {editor.isActive('heading', { level: 3 }) ? 'active' : ''}"
        title="Heading 3"
      >
        <span class="i-lucide-heading-3"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Lists -->
      <button
        onclick={toggleBulletList}
        class="toolbar-btn {editor.isActive('bulletList') ? 'active' : ''}"
        title="Bullet List"
      >
        <span class="i-lucide-list"></span>
      </button>
      <button
        onclick={toggleOrderedList}
        class="toolbar-btn {editor.isActive('orderedList') ? 'active' : ''}"
        title="Numbered List"
      >
        <span class="i-lucide-list-ordered"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Block elements -->
      <button
        onclick={toggleBlockquote}
        class="toolbar-btn {editor.isActive('blockquote') ? 'active' : ''}"
        title="Quote"
      >
        <span class="i-lucide-quote"></span>
      </button>
      <button
        onclick={toggleCodeBlock}
        class="toolbar-btn {editor.isActive('codeBlock') ? 'active' : ''}"
        title="Code Block"
      >
        <span class="i-lucide-file-code"></span>
      </button>
      <button
        onclick={insertHorizontalRule}
        class="toolbar-btn"
        title="Horizontal Rule"
      >
        <span class="i-lucide-minus"></span>
      </button>
      <button
        onclick={triggerImageUpload}
        class="toolbar-btn"
        title="Insert Image"
      >
        <span class="i-lucide-image"></span>
      </button>

      <div class="w-px h-5 bg-surface-3 mx-1"></div>

      <!-- Undo/Redo -->
      <button
        onclick={undo}
        disabled={!editor.can().undo()}
        class="toolbar-btn disabled:opacity-30"
        title="Undo (Ctrl+Z)"
      >
        <span class="i-lucide-undo"></span>
      </button>
      <button
        onclick={redo}
        disabled={!editor.can().redo()}
        class="toolbar-btn disabled:opacity-30"
        title="Redo (Ctrl+Shift+Z)"
      >
        <span class="i-lucide-redo"></span>
      </button>
    </div>
  {/if}

  <!-- Editor area - A4 paper style on large screens -->
  <div class="flex-1 overflow-auto bg-[#0d0d14] {loading ? 'hidden' : ''}">
    <div class="a4-page bg-[#1a1a24]">
      <div bind:this={editorElement} class="ProseMirror-container prose prose-sm max-w-none min-h-full"></div>
    </div>
  </div>

  <!-- Loading state -->
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-text-3">
      <span class="i-lucide-loader-2 animate-spin mr-2"></span>
      Loading document...
    </div>
  {/if}
</div>

<!-- Hidden file input for image upload -->
<input
  bind:this={imageFileInput}
  type="file"
  accept="image/*"
  onchange={handleFileInputChange}
  class="hidden"
/>

<style>
  /* A4 paper styling for large screens */
  .a4-page {
    min-height: 100%;
  }

  @media (min-width: 900px) {
    .a4-page {
      max-width: 816px;
      margin: 2rem auto;
      min-height: calc(100% - 4rem);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border-radius: 4px;
    }
  }

  /* Toolbar button styles */
  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border-radius: 0.25rem;
    background: transparent;
    border: none;
    color: var(--color-text-1);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .toolbar-btn:hover {
    background: var(--color-surface-2);
  }

  .toolbar-btn.active {
    background: var(--color-surface-3);
    color: var(--color-accent);
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .toolbar-btn span {
    font-size: 1rem;
  }

  :global(.ProseMirror-container .ProseMirror) {
    min-height: 200px;
    padding: 1rem;
  }

  @media (min-width: 900px) {
    :global(.ProseMirror-container .ProseMirror) {
      padding: 2rem 3rem;
    }
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

  /* Image styles */
  :global(.ProseMirror-container .ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 1rem 0;
  }

  :global(.ProseMirror-container .ProseMirror img.ProseMirror-selectednode) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
