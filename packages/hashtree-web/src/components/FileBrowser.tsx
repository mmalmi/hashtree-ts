import { useState, useCallback, useEffect, useRef, DragEvent, KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toHex, nhashEncode } from 'hashtree';
import { formatBytes } from '../store';
import { deleteEntry, moveEntry, moveToParent } from '../actions';
import { openCreateModal, openShareModal } from '../hooks/useModals';
import { useUpload } from '../hooks/useUpload';
import { useRecentlyChanged } from '../hooks/useRecentlyChanged';
import { useNostrStore, npubToPubkey } from '../nostr';
import { UserRow } from './user';
import { FolderActions } from './FolderActions';
import { VisibilityIcon, LinkLockIcon } from './VisibilityIcon';
import { useSelectedFile, useRoute, useCurrentPath, useCurrentDirCid, useTrees, useDirectoryEntries, useTreeRoot } from '../hooks';
import { readFilesFromDataTransfer, hasDirectoryItems } from '../utils/directory';

// Get icon class based on file extension
function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    // Images
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
    case 'bmp':
      return 'i-lucide-image';
    // Video
    case 'mp4':
    case 'webm':
    case 'mkv':
    case 'avi':
    case 'mov':
      return 'i-lucide-video';
    // Audio
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
    case 'm4a':
      return 'i-lucide-music';
    // Code
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'c':
    case 'cpp':
    case 'h':
    case 'java':
    case 'php':
    case 'sh':
    case 'bash':
      return 'i-lucide-file-code';
    // Config/data
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'ini':
    case 'env':
      return 'i-lucide-file-json';
    // Documents
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
    case 'markdown':
    case 'rst':
      return 'i-lucide-file-text';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'i-lucide-file-spreadsheet';
    case 'ppt':
    case 'pptx':
      return 'i-lucide-file-presentation';
    // Archives
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
      return 'i-lucide-file-archive';
    // HTML/CSS
    case 'html':
    case 'htm':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'i-lucide-file-code';
    default:
      return 'i-lucide-file';
  }
}

// Build href for an entry using URL path segments
function buildEntryHref(
  entry: { name: string; isTree: boolean },
  currentNpubVal: string | null,
  currentTreeNameVal: string | null,
  currentPathVal: string[],
  rootHashVal: Uint8Array | null,
  linkKey: string | null
): string {
  const parts: string[] = [];
  const suffix = linkKey ? `?k=${linkKey}` : '';

  if (currentNpubVal && currentTreeNameVal) {
    parts.push(currentNpubVal, currentTreeNameVal);
    parts.push(...currentPathVal);
    parts.push(entry.name);
    return '/' + parts.map(encodeURIComponent).join('/') + suffix;
  } else if (rootHashVal) {
    // Use nhash format: /nhash1.../path/to/file
    const nhash = nhashEncode(toHex(rootHashVal));
    parts.push(nhash);
    parts.push(...currentPathVal);
    parts.push(entry.name);
    return '/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  parts.push(...currentPathVal);
  parts.push(entry.name);
  return '/' + parts.map(encodeURIComponent).join('/') + suffix;
}

// Build href for a tree (root of tree, no path)
function buildTreeHref(ownerNpub: string, treeName: string, linkKey?: string): string {
  const base = `/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(treeName)}`;
  return linkKey ? `${base}?k=${linkKey}` : base;
}

export function FileBrowser() {
  // Get rootCid from URL via resolver (no app state needed)
  const rootCid = useTreeRoot();
  const rootHash = rootCid?.hash ?? null;
  const currentDirCid = useCurrentDirCid();
  const { entries, isDirectory } = useDirectoryEntries(currentDirCid);
  const recentlyChangedFiles = useRecentlyChanged();

  // Derive from URL - source of truth
  const selectedEntry = useSelectedFile(entries);
  const currentPath = useCurrentPath();

  const isLoggedIn = useNostrStore(s => s.isLoggedIn);
  const userNpub = useNostrStore(s => s.npub);

  // Get route info from URL
  const route = useRoute();
  const currentNpub = route.npub;
  const currentTreeName = route.treeName;
  const routeLinkKey = route.linkKey;

  const viewedNpub = currentNpub;
  const inTreeView = !!currentTreeName || !!rootHash;
  const isOwnTrees = !viewedNpub || viewedNpub === userNpub;
  const canEdit = isOwnTrees || !isLoggedIn;

  // Check if we're viewing an encrypted tree but can't decrypt it
  // This happens when: we have a hash, but no key, and it's not a public tree
  const hasHashButNoKey = rootCid?.hash && !rootCid?.key;

  // Get trees from resolver subscription
  const targetNpub = viewedNpub || userNpub;
  const trees = useTrees(targetNpub);
  const currentTree = currentTreeName ? trees.find(t => t.name === currentTreeName) : null;
  const { uploadFiles, uploadDirectory } = useUpload();

  const navigateTo = useNavigate();

  // Keyboard focus index (separate from URL-selected file)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Auto-focus file list when view changes (tree list <-> file browser)
  useEffect(() => {
    // Small delay to ensure DOM is ready after navigation
    const timer = setTimeout(() => {
      fileListRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [inTreeView, currentTreeName, currentPath.join('/')]);

  // Sync focused index with selected entry when it changes
  const selectedIndex = selectedEntry ? entries.findIndex(ent => ent.name === selectedEntry.name) : -1;

  // Build the root href for ".." when at top level (goes to user's tree list)
  const buildRootHref = () => {
    if (viewedNpub) return `/${viewedNpub}`;
    return '/';
  };

  // Build href for a directory path using URL segments
  const buildDirHref = (path: string[]): string => {
    const parts: string[] = [];
    const suffix = routeLinkKey ? `?k=${routeLinkKey}` : '';

    if (currentNpub && currentTreeName) {
      parts.push(currentNpub, currentTreeName);
      parts.push(...path);
      return '/' + parts.map(encodeURIComponent).join('/') + suffix;
    } else if (rootHash) {
      // Use nhash format: /nhash1.../path
      const nhash = nhashEncode(toHex(rootHash));
      parts.push(nhash);
      parts.push(...path);
      return '/' + parts.map(encodeURIComponent).join('/') + suffix;
    }

    parts.push(...path);
    return '/' + parts.map(encodeURIComponent).join('/') + suffix;
  };

  // Build navigation items list: [.., ., ...entries]
  // Include parent (..) only when we have a parent to go to
  const hasParent = currentNpub || currentPath.length > 0;
  // Navigation items: special items + entries
  // -2 = parent (..), -1 = current (.), 0+ = entries
  const navItemCount = (hasParent ? 1 : 0) + 1 + entries.length; // parent? + current + entries

  // Convert focused index to entry index (accounting for special items)
  const specialItemCount = (hasParent ? 1 : 0) + 1; // parent? + current

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key.toLowerCase();

    // Handle Delete key - delete focused or selected item (only for actual entries)
    if ((key === 'delete' || key === 'backspace') && canEdit) {
      const entryIndex = focusedIndex - specialItemCount;
      const targetEntry = entryIndex >= 0 ? entries[entryIndex] : selectedEntry;
      if (targetEntry) {
        e.preventDefault();
        if (confirm(`Delete ${targetEntry.name}?`)) {
          deleteEntry(targetEntry.name);
          setFocusedIndex(-1);
        }
      }
      return;
    }

    // Handle Enter key - navigate to focused item
    if (key === 'enter' && focusedIndex >= 0) {
      e.preventDefault();
      if (hasParent && focusedIndex === 0) {
        // Navigate to parent
        navigateTo(currentPath.length > 0 ? buildDirHref(currentPath.slice(0, -1)) : buildRootHref());
        setFocusedIndex(-1);
      } else if (focusedIndex === (hasParent ? 1 : 0)) {
        // Navigate to current (just refresh/select current dir)
        navigateTo(buildDirHref(currentPath));
        setFocusedIndex(-1);
      } else {
        // Navigate to entry
        const entryIndex = focusedIndex - specialItemCount;
        const entry = entries[entryIndex];
        if (entry) {
          const href = buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootHash, routeLinkKey);
          navigateTo(href);
          setFocusedIndex(-1);
        }
      }
      return;
    }

    if (key !== 'arrowup' && key !== 'arrowdown' && key !== 'arrowleft' && key !== 'arrowright' && key !== 'j' && key !== 'k' && key !== 'h' && key !== 'l') return;

    // Don't prevent browser back/forward navigation (Ctrl/Cmd + Arrow)
    if (e.ctrlKey || e.metaKey) return;

    e.preventDefault();

    // Start from focused index, or derive from selected entry
    let currentIndex = focusedIndex;
    if (currentIndex < 0 && selectedIndex >= 0) {
      currentIndex = selectedIndex + specialItemCount;
    }

    let newIndex: number;

    if (key === 'arrowdown' || key === 'arrowright' || key === 'j' || key === 'l') {
      newIndex = currentIndex < navItemCount - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : navItemCount - 1;
    }

    // Check if it's a special item or entry
    if (hasParent && newIndex === 0) {
      // Parent directory - just focus
      setFocusedIndex(newIndex);
    } else if (newIndex === (hasParent ? 1 : 0)) {
      // Current directory - just focus
      setFocusedIndex(newIndex);
    } else {
      // Entry
      const entryIndex = newIndex - specialItemCount;
      const newEntry = entries[entryIndex];
      if (newEntry) {
        if (newEntry.isTree) {
          // Directory: just focus it, don't navigate
          setFocusedIndex(newIndex);
        } else {
          // File: navigate to it and clear focus
          setFocusedIndex(-1);
          const href = buildEntryHref(newEntry, currentNpub, currentTreeName, currentPath, rootHash, routeLinkKey);
          navigateTo(href);
        }
      }
    }
  }, [entries, focusedIndex, selectedIndex, selectedEntry, currentNpub, currentTreeName, currentPath, rootHash, routeLinkKey, navigateTo, canEdit, hasParent, navItemCount, specialItemCount]);

  // Drag-and-drop state
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Handle drag start for internal file moves
  const handleDragStart = (e: DragEvent<HTMLElement>, name: string) => {
    if (!canEdit) return;
    setDraggedItem(name);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', name);
  };

  // Handle drag over directory (for internal moves)
  const handleDragOverDir = (e: DragEvent<HTMLElement>, dirName: string) => {
    if (!canEdit) return;
    if (draggedItem && draggedItem !== dirName) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      setDropTarget(dirName);
    }
  };

  // Handle drop on directory (for internal moves)
  const handleDropOnDir = async (e: DragEvent<HTMLElement>, dirName: string) => {
    e.preventDefault();
    if (!canEdit || !draggedItem) return;
    if (draggedItem !== dirName) {
      await moveEntry(draggedItem, dirName);
    }
    setDraggedItem(null);
    setDropTarget(null);
  };

  // Handle drag leave
  const handleDragLeave = () => {
    setDropTarget(null);
  };

  // Handle drag end (cleanup)
  const handleDragEnd = () => {
    setDraggedItem(null);
    setDropTarget(null);
  };

  // Handle external file drop on file list (supports directories)
  const handleFileDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    // Check if this drop contains directories - use the directory-aware reader
    if (hasDirectoryItems(dataTransfer) || dataTransfer.items?.length > 0) {
      const result = await readFilesFromDataTransfer(dataTransfer);
      if (result.files.length > 0) {
        await uploadDirectory(result);
        return;
      }
    }

    // Fallback for regular files without directory structure
    const files = dataTransfer.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  };

  // Handle drag over file list (for external files)
  const handleFileDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    if (!draggedItem && e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingOver(true);
    }
  };

  const handleFileDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      setIsDraggingOver(false);
    }
  };

  // Handle drag over parent directory row
  const handleDragOverParent = (e: DragEvent<HTMLElement>) => {
    if (!canEdit) return;
    if (draggedItem) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      setDropTarget('__parent__');
    }
  };

  // Handle drop on parent directory row
  const handleDropOnParent = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!canEdit || !draggedItem) return;
    await moveToParent(draggedItem);
    setDraggedItem(null);
    setDropTarget(null);
  };

  // Tree list keyboard navigation
  const [treeFocusedIndex, setTreeFocusedIndex] = useState<number>(-1);

  // Build tree list for navigation (public first, then link, private, others)
  // Priority order for default folders: public, link, private
  const defaultFolderOrder = ['public', 'link', 'private'];
  const sortedTrees = isOwnTrees
    ? [...trees].sort((a, b) => {
        const aIdx = defaultFolderOrder.indexOf(a.name);
        const bIdx = defaultFolderOrder.indexOf(b.name);
        // Default folders come first in order, non-defaults at end
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
        return a.name.localeCompare(b.name);
      })
    : trees;
  const treeList = sortedTrees;

  // Handle keyboard navigation for tree list
  const handleTreeListKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (treeList.length === 0) return;

    const key = e.key.toLowerCase();

    // Handle Enter key - navigate to focused tree
    if (key === 'enter' && treeFocusedIndex >= 0) {
      e.preventDefault();
      const tree = treeList[treeFocusedIndex];
      if (tree) {
        navigateTo(buildTreeHref(targetNpub!, tree.name, 'linkKey' in tree ? tree.linkKey : undefined));
        setTreeFocusedIndex(-1);
      }
      return;
    }

    if (key !== 'arrowup' && key !== 'arrowdown' && key !== 'j' && key !== 'k') return;

    e.preventDefault();

    // Find currently selected tree index
    const selectedTreeIndex = currentTreeName ? treeList.findIndex(t => t.name === currentTreeName) : -1;
    const currentIndex = treeFocusedIndex >= 0 ? treeFocusedIndex : selectedTreeIndex;
    let newIndex: number;

    if (key === 'arrowdown' || key === 'j') {
      newIndex = currentIndex < treeList.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : treeList.length - 1;
    }

    setTreeFocusedIndex(newIndex);
  }, [treeList, treeFocusedIndex, currentTreeName, targetNpub, navigateTo]);

  // Show tree list when at root (no tree selected)
  if (!inTreeView) {
    // Determine which user to show in header
    const headerNpub = viewedNpub || (isLoggedIn ? userNpub : null);
    const headerPubkey = headerNpub ? (npubToPubkey(headerNpub) || headerNpub) : null;

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-surface-1">
        {/* Header with user info */}
        <div className="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
          {headerPubkey ? (
            <Link to={`/${headerNpub}/profile`} className="no-underline min-w-0">
              <UserRow pubkey={headerPubkey} avatarSize={24} showBadge={!isOwnTrees} className="min-w-0" />
            </Link>
          ) : (
            <span className="text-sm text-text-2">Folders</span>
          )}
          {/* Share button - shares tree list URL for the displayed user */}
          <button
            onClick={() => {
              const base = window.location.origin + window.location.pathname + '#';
              openShareModal(base + (headerNpub ? `/${headerNpub}` : '/'));
            }}
            className="ml-auto btn-ghost p-1.5"
            title="Share"
          >
            <span className="i-lucide-share" />
          </button>
        </div>

        {/* New folder button */}
        {isOwnTrees && (
          <button
            onClick={() => openCreateModal('tree')}
            className="shrink-0 mx-3 mt-3 btn-ghost border border-dashed border-surface-3 flex items-center justify-center gap-2 py-3 text-sm text-text-2 hover:text-text-1 hover:border-accent"
          >
            <span className="i-lucide-folder-plus" />
            New Folder
          </button>
        )}

        {/* Tree list */}
        <div
          ref={fileListRef}
          data-testid="file-list"
          className="flex-1 overflow-auto pb-4 outline-none"
          tabIndex={0}
          onKeyDown={handleTreeListKeyDown}
        >
          {treeList.length === 0 ? (
            <div className="p-8 text-center text-muted">
              Add files to begin
            </div>
          ) : treeList.map((tree, idx) => (
            <Link
              key={tree.key}
              to={buildTreeHref(targetNpub!, tree.name, 'linkKey' in tree ? tree.linkKey : undefined)}
              className={`p-3 border-b border-surface-2 flex items-center gap-3 cursor-pointer no-underline text-text-1 min-w-0 ${
                currentTreeName === tree.name ? 'bg-surface-2' : 'hover:bg-surface-1'
              } ${treeFocusedIndex === idx ? 'ring-2 ring-inset ring-accent' : ''}`}
            >
              <span className="shrink-0 i-lucide-folder text-warning" />
              <span className="truncate" title={tree.name}>{tree.name}</span>
              {'visibility' in tree && (
                <VisibilityIcon visibility={tree.visibility} className="ml-auto text-text-3" />
              )}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const buildParentHref = () => buildDirHref(currentPath.slice(0, -1));
  const buildCurrentDirHref = () => buildDirHref(currentPath);

  // Display name for the root - use nhash format for hash-based permalinks
  const rootDisplayName = currentTreeName || (rootHash ? nhashEncode(toHex(rootHash)).slice(0, 16) + '...' : '');

  // Get current directory name for display
  const currentDirName = currentPath.length > 0 ? currentPath[currentPath.length - 1] : rootDisplayName;

  // Show file browser when inside a tree
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-1">
      {/* Header with user info when viewing someone's tree */}
      {viewedNpub && (
        <div className="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
          <Link to={`/${viewedNpub}/profile`} className="no-underline min-w-0">
            <UserRow pubkey={npubToPubkey(viewedNpub) || viewedNpub} avatarSize={24} showBadge={!isOwnTrees} className="min-w-0" />
          </Link>
        </div>
      )}

      {/* Mobile action buttons - hide when viewing locked unlisted/private directory */}
      {(currentDirCid || canEdit) && !(hasHashButNoKey && currentTree && (currentTree.visibility === 'unlisted' || currentTree.visibility === 'private')) && (
        <div className="lg:hidden px-3 py-2 border-b border-surface-3 bg-surface-1">
          <FolderActions dirCid={currentDirCid ?? undefined} canEdit={canEdit} compact />
        </div>
      )}

      {/* File list */}
      <div
        ref={fileListRef}
        data-testid="file-list"
        className={`flex-1 overflow-auto relative outline-none pb-4 ${isDraggingOver ? 'bg-accent/10' : ''}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 border-2 border-dashed border-accent rounded m-2">
            <span className="text-accent font-medium">Drop files to add</span>
          </div>
        )}

        {/* Parent directory row - navigation and drop target */}
        {/* Hide ".." for nhash routes at root level (no parent to go to) */}
        {hasParent && (
          <Link
            to={currentPath.length > 0 ? buildParentHref() : buildRootHref()}
            onDragOver={currentPath.length > 0 && canEdit ? handleDragOverParent : undefined}
            onDragLeave={currentPath.length > 0 && canEdit ? handleDragLeave : undefined}
            onDrop={currentPath.length > 0 && canEdit ? handleDropOnParent : undefined}
            className={`p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 ${
              dropTarget === '__parent__' ? 'bg-accent/20 border-accent' : 'hover:bg-surface-2/50'
            } ${focusedIndex === 0 ? 'ring-2 ring-inset ring-accent' : ''}`}
          >
            <span className="i-lucide-folder text-warning shrink-0" />
            <span className="truncate">..</span>
          </Link>
        )}

        {/* Current directory/file row - shows file icon if hash is a file, otherwise folder */}
        <Link
          to={buildCurrentDirHref()}
          className={`p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 ${
            !selectedEntry && focusedIndex < 0 ? 'bg-surface-2' : ''
          } ${focusedIndex === (hasParent ? 1 : 0) ? 'ring-2 ring-inset ring-accent' : ''}`}
        >
          {currentTree && (
            <VisibilityIcon visibility={currentTree.visibility} className="text-text-2" />
          )}
          <span className={`shrink-0 ${isDirectory || hasHashButNoKey ? 'i-lucide-folder-open text-warning' : `${getFileIcon(currentDirName)} text-text-2`}`} />
          <span className="truncate">{currentDirName}</span>
        </Link>

        {/* Show locked indicator when we can't decrypt the tree */}
        {hasHashButNoKey && currentTree && (currentTree.visibility === 'unlisted' || currentTree.visibility === 'private') ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center mb-4">
              {currentTree.visibility === 'unlisted' ? (
                <LinkLockIcon className="text-3xl text-text-3" />
              ) : (
                <span className="i-lucide-lock text-3xl text-text-3" />
              )}
            </div>
            <div className="text-text-2 font-medium mb-2">
              {currentTree.visibility === 'unlisted' ? 'Link Required' : 'Private Folder'}
            </div>
            <div className="text-text-3 text-sm max-w-xs mx-auto">
              {currentTree.visibility === 'unlisted'
                ? 'This folder requires a special link to access. Ask the owner for the link with the access key.'
                : 'This folder is private and can only be accessed by its owner.'}
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-4 pl-6 text-center text-muted text-sm">
            {isDraggingOver ? '' : 'Empty directory'}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <Link
              key={entry.name}
              to={buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootHash, routeLinkKey)}
              draggable={canEdit}
              onDragStart={(e) => handleDragStart(e, entry.name)}
              onDragEnd={handleDragEnd}
              onDragOver={entry.isTree ? (e) => handleDragOverDir(e, entry.name) : undefined}
              onDragLeave={entry.isTree ? handleDragLeave : undefined}
              onDrop={entry.isTree ? (e) => handleDropOnDir(e, entry.name) : undefined}
              className={`p-3 pl-9 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 ${
                selectedEntry?.name === entry.name ? 'bg-surface-2' : ''
              } ${focusedIndex === idx + specialItemCount ? 'ring-2 ring-inset ring-accent' : ''} ${
                draggedItem === entry.name ? 'opacity-50' : ''
              } ${dropTarget === entry.name ? 'bg-accent/20 border-accent' : ''} ${
                recentlyChangedFiles.has(entry.name) && selectedEntry?.name !== entry.name ? 'animate-pulse-live' : ''
              }`}
            >
              <span className={`shrink-0 ${entry.isTree ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}`} />
              <span className="truncate flex-1 min-w-0" title={entry.name}>{entry.name}</span>

              <span className="shrink-0 text-muted text-sm min-w-12 text-right">
                {!entry.isTree && entry.size !== undefined ? formatBytes(entry.size) : ''}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
