/**
 * YjsDocument - renders an editable Yjs document using Tiptap
 *
 * A Yjs document directory contains:
 * - A `.yjs` file with collaborator npubs (one per line) to merge from
 * - Delta files (binary Yjs updates) - any file that isn't `.yjs` or starting with `.`
 *
 * When collaborators are defined, this component will also fetch and merge
 * deltas from those users' hashtrees at the same relative path.
 *
 * Changes are auto-saved to the hashtree as Yjs delta files.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import type { CID, TreeEntry, Hash } from 'hashtree';
import { toHex, cid as makeCid } from 'hashtree';
import { getTree, decodeAsText } from '../store';
import { getRefResolver, getResolverKey } from '../refResolver';
import { useRoute, useCurrentPath, useTreeRoot, useTrees, getTreeRootSync } from '../hooks';
import { useNostrStore, autosaveIfOwn, saveHashtree } from '../nostr';
import { buildRouteUrl } from '../actions';
import { openForkModal, openCollaboratorsModal, openShareModal } from '../hooks/useModals';
import { updateLocalRootCache, getLocalRootCache } from '../treeRootCache';

interface YjsDocumentProps {
  /** CID of the directory containing .yjs */
  dirCid: CID;
  /** List of entries in the directory */
  entries: TreeEntry[];
}

/** Parse .yjs config file - returns list of npubs */
function parseYjsConfig(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('npub1'));
}

/** Check if a file is a delta file (not config files) */
function isDeltaFile(name: string): boolean {
  return name !== '.yjs' && !name.startsWith('.');
}

/** Suggest a fork name - use dirName unless it already exists */
function suggestForkName(dirName: string, existingTreeNames: string[]): string {
  if (!existingTreeNames.includes(dirName)) {
    return dirName;
  }
  let i = 2;
  while (existingTreeNames.includes(`${dirName}-${i}`)) {
    i++;
  }
  return `${dirName}-${i}`;
}

export function YjsDocument({ dirCid, entries }: YjsDocumentProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const route = useRoute();
  const currentPath = useCurrentPath();
  const rootCid = useTreeRoot();
  const userNpub = useNostrStore(s => s.npub);
  const viewedNpub = route.npub;

  // Check if viewing own tree
  const isOwnTree = !viewedNpub || viewedNpub === userNpub;

  // Check if user is listed as an editor (all editors are in .yjs, including self)
  const isEditor = userNpub ? collaborators.includes(userNpub) : false;

  // Can edit if viewing own tree OR if user is listed as an editor
  const canEdit = isOwnTree || isEditor;

  // Get user's trees for fork name suggestion
  const ownTrees = useTrees(userNpub);
  const ownTreeNames = ownTrees.map(t => t.name);

  // Document name (last path segment)
  const docName = currentPath.length > 0 ? currentPath[currentPath.length - 1] : 'document';

  // Parent path for back navigation
  const parentPath = currentPath.slice(0, -1);
  const parentUrl = buildRouteUrl(route.npub, route.treeName, parentPath, undefined, route.linkKey);

  // Handle fork
  const handleFork = () => {
    if (!dirCid) return;
    const suggestedName = suggestForkName(docName, ownTreeNames);
    openForkModal(dirCid, suggestedName);
  };

  // Save collaborators to .yjs file
  const saveCollaborators = useCallback(async (npubs: string[]) => {
    if (!canEdit || !rootCid) return;

    const tree = getTree();

    try {
      // Ensure owner's npub is always included in the list
      let allEditors = [...npubs];
      if (userNpub && !allEditors.includes(userNpub)) {
        allEditors = [userNpub, ...allEditors];
      }

      // Create .yjs file content (one npub per line)
      const content = allEditors.join('\n');
      const encoder = new TextEncoder();
      const data = encoder.encode(content);

      // Store the file
      const { cid: fileCid, size } = await tree.putFile(data);

      // Update the .yjs entry in the current directory
      const newRootCid = await tree.setEntry(
        rootCid,
        currentPath,
        '.yjs',
        fileCid,
        size
      );

      // Publish to nostr
      await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);

      // Update local cache for subsequent saves from other documents
      if (userNpub && route.treeName) {
        updateLocalRootCache(userNpub, route.treeName, newRootCid.hash);
      }

      // Update local state with full list including owner
      setCollaborators(allEditors);
    } catch (err) {
      console.error('Failed to save collaborators:', err);
    }
  }, [canEdit, rootCid, currentPath, userNpub, route.treeName]);

  // Ensure entries is always an array - use a stable empty array reference
  const emptyArray = useMemo(() => [] as TreeEntry[], []);
  const safeEntries = entries ?? emptyArray;

  // Track the last saved state to detect changes
  const lastSavedStateRef = useRef<Uint8Array | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the identity we loaded for (to detect stale entries during navigation)
  const loadedForIdentityRef = useRef<string | null>(null);

  // Document identity based on route - this is what we SHOULD be loading
  // When viewing someone else's tree, use their npub; otherwise use own npub or 'local'
  const expectedIdentity = `${viewedNpub || userNpub || 'local'}/${route.treeName || ''}`;

  // Create Yjs document - single instance per component mount
  // Component is remounted via key prop when navigating to different documents
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Load and apply deltas from the directory and collaborators
  useEffect(() => {
    // Skip if we've already loaded for this exact identity (prevents reload on save)
    // But allow reload if identity changed (navigation to different document)
    if (loadedForIdentityRef.current === expectedIdentity) {
      return;
    }

    // If we loaded for a DIFFERENT identity, we need to reload
    // This can happen when entries prop updates after navigation
    // With the key prop in DirectoryActions, the component should remount
    // so this branch shouldn't be hit normally.
    if (loadedForIdentityRef.current !== null && loadedForIdentityRef.current !== expectedIdentity) {
      return;
    }

    // Mark as loading for this identity immediately to prevent concurrent loads
    loadedForIdentityRef.current = expectedIdentity;

    let cancelled = false;

    async function loadDeltas() {
      try {
        setLoading(true);
        setError(null);

        const tree = getTree();
        const resolver = getRefResolver();

        // Find and read .yjs config file for collaborators
        const yjsConfigEntry = safeEntries.find(e => e.name === '.yjs' && !e.isTree);
        let collaboratorNpubs: string[] = [];

        if (yjsConfigEntry) {
          const data = await tree.readFile(yjsConfigEntry.cid);
          if (data) {
            const text = decodeAsText(data);
            if (text) {
              collaboratorNpubs = parseYjsConfig(text);
              setCollaborators(collaboratorNpubs);
            }
          }
        }

        // Sort delta entries by name (assumed to be numbered/ordered)
        const deltaEntries = [...safeEntries]
          .filter(e => !e.isTree && isDeltaFile(e.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Load and apply local deltas
        for (const entry of deltaEntries) {
          if (cancelled) return;

          const data = await tree.readFile(entry.cid);
          if (cancelled) return;
          if (!data) continue;

          // Apply the update to the Yjs document (mark as 'remote' to skip auto-save)
          Y.applyUpdate(ydoc, data, 'remote');
        }

        // Now load and merge deltas from other editors
        // The path to the document directory relative to tree root
        const docPath = currentPath.join('/');

        // Filter out the currently viewed tree's npub (we already loaded local deltas above)
        const otherEditors = collaboratorNpubs.filter(npub => npub !== route.npub);

        for (const npub of otherEditors) {
          if (cancelled) return;

          try {
            // Get the editor's tree with the same name as current tree
            const treeName = route.treeName;
            if (!treeName) continue;

            // Resolve the editor's tree root with encryption key via subscription
            const resolverKey = `${npub}/${treeName}`;
            const resolved = await new Promise<{ hash: Hash; encryptionKey?: Hash } | null>((resolve) => {
              let hasResolved = false;
              const unsub = resolver.subscribe(resolverKey, (hash, encryptionKey) => {
                if (hasResolved) return;
                hasResolved = true;
                unsub();
                if (hash) {
                  resolve({ hash, encryptionKey });
                } else {
                  resolve(null);
                }
              });
              // Timeout after 5 seconds
              setTimeout(() => {
                if (!hasResolved) {
                  hasResolved = true;
                  unsub();
                  resolve(null);
                }
              }, 5000);
            });
            if (!resolved) continue;

            // Create CID from hash with encryption key
            const cid = makeCid(resolved.hash, resolved.encryptionKey);

            // Resolve the path to the document directory in their tree
            const result = await tree.resolvePath(cid, docPath);
            if (!result || cancelled) continue;

            // Check if it's a directory
            const isDir = await tree.isDirectory(result.cid);
            if (!isDir || cancelled) continue;

            // List entries in their document directory
            const collabEntries = await tree.listDirectory(result.cid);
            if (cancelled) return;

            // Sort and apply their deltas
            const collabDeltas = collabEntries
              .filter(e => !e.isTree && isDeltaFile(e.name))
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

            for (const entry of collabDeltas) {
              if (cancelled) return;

              const data = await tree.readFile(entry.cid);
              if (cancelled) return;
              if (!data) continue;

              // Mark as 'remote' to skip auto-save
              Y.applyUpdate(ydoc, data, 'remote');
            }
          } catch (err) {
            // Continue with other collaborators if one fails
            console.warn(`Failed to load deltas from collaborator ${npub}:`, err);
          }
        }

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
          setLoading(false);
        }
      }
    }

    loadDeltas();

    return () => {
      cancelled = true;
    };
  }, [safeEntries, ydoc, route.treeName, currentPath.join('/'), route.npub, expectedIdentity]);

  // Subscribe to other editors' trees and fetch updates when they change
  useEffect(() => {
    if (collaborators.length === 0 || !route.treeName) return;

    const resolver = getRefResolver();
    const tree = getTree();
    const docPath = currentPath.join('/');
    const unsubscribes: (() => void)[] = [];

    // Subscribe to each editor's tree (except the currently viewed one)
    const otherEditors = collaborators.filter(npub => npub !== route.npub);

    for (const npub of otherEditors) {
      const resolverKey = `${npub}/${route.treeName}`;

      const unsub = resolver.subscribe(resolverKey, async (hash: Hash | null, encryptionKey?: Hash) => {
        if (!hash) return;

        try {
          // Fetch and apply deltas from this editor (include encryption key)
          const rootCid = makeCid(hash, encryptionKey);
          const result = await tree.resolvePath(rootCid, docPath);
          if (!result) return;

          const isDir = await tree.isDirectory(result.cid);
          if (!isDir) return;

          const entries = await tree.listDirectory(result.cid);
          const deltaEntries = entries
            .filter(e => !e.isTree && isDeltaFile(e.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

          for (const entry of deltaEntries) {
            const data = await tree.readFile(entry.cid);
            if (data) {
              // Mark as 'remote' so auto-save doesn't trigger
              Y.applyUpdate(ydoc, data, 'remote');
            }
          }
        } catch (err) {
          console.warn(`Failed to fetch updates from editor ${npub}:`, err);
        }
      });

      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [collaborators, route.treeName, route.npub, currentPath.join('/'), ydoc]);

  // Save function - writes the full Yjs state as a delta file
  // If viewing someone else's document as a collaborator, saves to user's own tree
  const saveDocument = useCallback(async () => {
    if (!canEdit) return;

    const tree = getTree();

    try {
      setSaving(true);

      // Get the full encoded state of the Yjs document
      const state = Y.encodeStateAsUpdate(ydoc);

      // Check if state has actually changed
      if (lastSavedStateRef.current) {
        const prevState = lastSavedStateRef.current;
        if (state.length === prevState.length && state.every((v, i) => v === prevState[i])) {
          setSaving(false);
          return; // No changes
        }
      }

      // Determine where to save
      let targetRootCid: CID | null = null;
      let targetCollaborators: string[] = [];

      if (isOwnTree) {
        // Saving to own tree - use the current rootCid
        targetRootCid = rootCid;
        targetCollaborators = collaborators;
      } else if (isEditor && userNpub && route.treeName) {
        // Saving to user's own tree at the same path
        // First, get the encryption key from ownTrees (needed for all CID operations)
        const myTree = ownTrees.find(t => t.name === route.treeName);
        const encryptionKey = myTree?.encryptionKey;

        // Check local cache first (most up-to-date after recent saves)
        const cachedHash = getLocalRootCache(userNpub, route.treeName);
        if (cachedHash) {
          targetRootCid = makeCid(cachedHash, encryptionKey);
        } else if (myTree) {
          // Use hash and key from ownTrees
          targetRootCid = makeCid(myTree.hash, encryptionKey);
        } else {
          // Fallback to sync cache or async resolve
          targetRootCid = getTreeRootSync(userNpub, route.treeName);

          if (!targetRootCid) {
            // User's tree not in cache, resolve it async
            const resolver = getRefResolver();
            const resolverKey = `${userNpub}/${route.treeName}`;
            const hash = await resolver.resolve(resolverKey);
            if (hash) {
              // Note: encryptionKey is null here since myTree wasn't found
              // This path is rarely hit but we include key for consistency
              targetRootCid = makeCid(hash, encryptionKey);
            }
          }
        }

        // Include the viewed document owner as an editor
        if (viewedNpub) {
          targetCollaborators = collaborators.includes(viewedNpub)
            ? collaborators
            : [...collaborators.filter(n => n !== userNpub), viewedNpub];
        }
      }

      if (!targetRootCid) {
        console.error('Cannot save: no target tree found');
        setSaving(false);
        return;
      }

      // Store the state as a file
      const { cid: fileCid, size } = await tree.putFile(state);

      // Check if the path exists in the target tree (needed for editor saving to own tree)
      // If not, we need to create the document folder first
      let workingRootCid = targetRootCid;

      if (!isOwnTree && isEditor && currentPath.length > 0) {
        // Check if path exists by trying to resolve it
        const pathStr = currentPath.join('/');
        const resolved = await tree.resolvePath(targetRootCid, pathStr);

        if (!resolved) {

          // Create the document folder hierarchy
          // For each segment of the path, we need to ensure it exists
          for (let i = 0; i < currentPath.length; i++) {
            const partialPath = currentPath.slice(0, i);
            const segmentName = currentPath[i];

            // Check if this segment exists
            const segmentPath = partialPath.length > 0 ? partialPath.join('/') : '';
            const parentResolved = segmentPath ? await tree.resolvePath(workingRootCid, segmentPath) : { cid: workingRootCid };

            if (parentResolved) {
              // Check if segmentName exists in parent
              const parentEntries = await tree.listDirectory(parentResolved.cid);
              const segmentExists = parentEntries.some(e => e.name === segmentName);

              if (!segmentExists) {
                // Create an empty directory for this segment
                const { cid: emptyDirCid } = await tree.putDirectory([]);
                workingRootCid = await tree.setEntry(
                  workingRootCid,
                  partialPath,
                  segmentName,
                  emptyDirCid,
                  0,
                  true
                );
              }
            }
          }
        }
      }

      // Add/update the "doc" entry in the current directory
      let newRootCid = await tree.setEntry(
        workingRootCid,
        currentPath,
        'doc',
        fileCid,
        size
      );

      // If saving as collaborator, also create/update the .yjs file with collaborators
      if (!isOwnTree && isEditor && targetCollaborators.length > 0) {
        const yjsContent = targetCollaborators.join('\n');
        const encoder = new TextEncoder();
        const yjsData = encoder.encode(yjsContent);
        const { cid: yjsCid, size: yjsSize } = await tree.putFile(yjsData);

        newRootCid = await tree.setEntry(
          newRootCid,
          currentPath,
          '.yjs',
          yjsCid,
          yjsSize
        );
      }

      // Publish to nostr and update local cache
      if (isOwnTree) {
        // Use autosaveIfOwn for own trees (preserves visibility settings)
        await autosaveIfOwn(toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
        // Update local cache so subsequent saves from other documents use this hash
        if (userNpub && route.treeName) {
          updateLocalRootCache(userNpub, route.treeName, newRootCid.hash);
        }
      } else if (userNpub && route.treeName) {
        // When editing someone else's document as editor, save to user's own tree
        await saveHashtree(route.treeName, toHex(newRootCid.hash), newRootCid.key ? toHex(newRootCid.key) : undefined);
        // Update local cache for subsequent saves
        updateLocalRootCache(userNpub, route.treeName, newRootCid.hash);
      }

      lastSavedStateRef.current = state;
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save document:', err);
    } finally {
      setSaving(false);
    }
  }, [canEdit, isOwnTree, isEditor, rootCid, ydoc, currentPath, userNpub, viewedNpub, route.treeName, collaborators, ownTrees]);

  // Debounced auto-save on changes
  const scheduleAutoSave = useCallback(() => {
    if (!canEdit) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveDocument();
    }, 1000); // Save 1 second after last change
  }, [canEdit, saveDocument]);

  // Listen for Yjs updates and schedule auto-save
  // Only save on LOCAL updates (not remote updates from subscriptions)
  useEffect(() => {
    if (!canEdit) return;

    const handleUpdate = (_update: Uint8Array, origin: unknown) => {
      // Only auto-save for local changes (origin is null/undefined for local edits)
      // Remote updates from Y.applyUpdate have 'remote' as origin
      if (origin === 'remote') return;
      scheduleAutoSave();
    };

    ydoc.on('update', handleUpdate);

    return () => {
      ydoc.off('update', handleUpdate);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [ydoc, canEdit, scheduleAutoSave]);

  // Create Tiptap editor with Yjs collaboration
  // Only create editor after loading completes to ensure Y.Doc has been populated with deltas
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
      Collaboration.configure({
        document: ydoc,
        field: 'default',  // Use 'default' XmlFragment - must match across all instances
      }),
    ],
    editable: canEdit,
  }, [ydoc, canEdit, loading]);  // Re-create editor when loading state changes

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted">
        <span className="i-lucide-loader-2 animate-spin mr-2" />
        Loading document...
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-danger">
        <span className="i-lucide-alert-circle mr-2" />
        {error}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-3 text-sm shrink-0">
        <div className="flex items-center gap-2">
          {/* Back navigation */}
          <Link
            to={parentUrl}
            className="btn-ghost p-1 no-underline"
            title="Go back"
          >
            <span className="i-lucide-chevron-left text-base" />
          </Link>
          <span className="i-lucide-file-text text-muted" />
          <span className="font-medium">{docName}</span>
          {canEdit && (
            <span className="i-lucide-pencil text-xs text-muted" title={isOwnTree ? "You can edit this document" : "Editing as editor - saves to your tree"} />
          )}
          {!canEdit && (
            <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-muted">Read-only</span>
          )}
          {isEditor && !isOwnTree && (
            <span className="text-xs px-2 py-0.5 rounded bg-success/20 text-success" title="You are an editor - edits save to your tree">Editor</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Save status */}
          <div className="flex items-center gap-2 text-muted">
            {saving && (
              <>
                <span className="i-lucide-loader-2 animate-spin" />
                <span>Saving...</span>
              </>
            )}
            {!saving && lastSaved && (
              <span className="text-xs">
                Saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
          {/* Share button */}
          <button
            onClick={() => openShareModal(window.location.href)}
            className="btn-ghost flex items-center gap-1 px-2 py-1 text-sm"
            title="Share document"
          >
            <span className="i-lucide-share-2" />
          </button>
          {/* Collaborators button (show for all, read-only for viewers) */}
          <button
            onClick={() => {
              if (isOwnTree) {
                openCollaboratorsModal(collaborators, saveCollaborators);
              } else {
                // Read-only mode: pass undefined for onSave
                openCollaboratorsModal(collaborators);
              }
            }}
            className="btn-ghost flex items-center gap-1 px-2 py-1 text-sm"
            title={isOwnTree ? "Manage editors" : "View editors"}
          >
            <span className="i-lucide-users" />
            {collaborators.length > 0 && (
              <span className="text-xs bg-surface-2 px-1.5 rounded-full">{collaborators.length}</span>
            )}
          </button>
          {/* Fork button */}
          <button
            onClick={handleFork}
            className="btn-ghost flex items-center gap-1 px-2 py-1 text-sm"
            title="Fork document as new tree"
          >
            <span className="i-lucide-git-fork" />
            Fork
          </button>
        </div>
      </div>

      {/* Formatting Toolbar */}
      {canEdit && editor && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-surface-3 bg-surface-1 shrink-0 flex-wrap">
          {/* Text formatting */}
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('bold') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Bold (Ctrl+B)"
          >
            <span className="i-lucide-bold text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('italic') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Italic (Ctrl+I)"
          >
            <span className="i-lucide-italic text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('strike') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Strikethrough"
          >
            <span className="i-lucide-strikethrough text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('code') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Inline Code"
          >
            <span className="i-lucide-code text-sm" />
          </button>

          <div className="w-px h-5 bg-surface-3 mx-1" />

          {/* Headings */}
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`btn-ghost p-1.5 ${editor.isActive('heading', { level: 1 }) ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Heading 1"
          >
            <span className="i-lucide-heading-1 text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`btn-ghost p-1.5 ${editor.isActive('heading', { level: 2 }) ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Heading 2"
          >
            <span className="i-lucide-heading-2 text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`btn-ghost p-1.5 ${editor.isActive('heading', { level: 3 }) ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Heading 3"
          >
            <span className="i-lucide-heading-3 text-sm" />
          </button>

          <div className="w-px h-5 bg-surface-3 mx-1" />

          {/* Lists */}
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('bulletList') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Bullet List"
          >
            <span className="i-lucide-list text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('orderedList') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Numbered List"
          >
            <span className="i-lucide-list-ordered text-sm" />
          </button>

          <div className="w-px h-5 bg-surface-3 mx-1" />

          {/* Block elements */}
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('blockquote') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Quote"
          >
            <span className="i-lucide-quote text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`btn-ghost p-1.5 ${editor.isActive('codeBlock') ? 'bg-surface-3 text-foreground' : 'text-muted'}`}
            title="Code Block"
          >
            <span className="i-lucide-file-code text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="btn-ghost p-1.5 text-muted"
            title="Horizontal Rule"
          >
            <span className="i-lucide-minus text-sm" />
          </button>

          <div className="w-px h-5 bg-surface-3 mx-1" />

          {/* Undo/Redo */}
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="btn-ghost p-1.5 text-muted disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <span className="i-lucide-undo text-sm" />
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="btn-ghost p-1.5 text-muted disabled:opacity-30"
            title="Redo (Ctrl+Shift+Z)"
          >
            <span className="i-lucide-redo text-sm" />
          </button>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-auto">
        <div className="prose prose-sm max-w-none p-4 min-h-full">
          <EditorContent
            editor={editor}
            className="min-h-[300px] outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
}
