import { useState, useCallback, DragEvent, KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toHex } from 'hashtree';
import { useAppStore, formatBytes } from '../store';
import { deleteEntry, moveEntry, moveToParent } from '../actions';
import { openCreateModal } from '../hooks/useModals';
import { useUpload } from '../hooks/useUpload';
import { useRecentlyChanged } from '../hooks/useRecentlyChanged';
import { useNostrStore, pubkeyToNpub, npubToPubkey } from '../nostr';
import { UserRow } from './user';
import { FolderActions } from './FolderActions';
import { useSelectedFile, useRoute, useCurrentPath, useCurrentDirHash, useTrees, useDirectoryEntries } from '../hooks';

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

// Build href for an entry
function buildEntryHref(
  entry: { name: string; isTree: boolean },
  currentNpubVal: string | null,
  currentTreeNameVal: string | null,
  currentPathVal: string[],
  rootHashVal: Uint8Array | null
): string {
  const parts: string[] = [];

  if (currentNpubVal && currentTreeNameVal) {
    parts.push(currentNpubVal, currentTreeNameVal);
    parts.push(...currentPathVal);
    parts.push(entry.name);
    return '/' + parts.map(encodeURIComponent).join('/');
  } else if (rootHashVal) {
    const hashHex = toHex(rootHashVal);
    parts.push('h', hashHex);
    parts.push(...currentPathVal);
    parts.push(entry.name);
    return '/' + parts.map(encodeURIComponent).join('/');
  }

  parts.push(...currentPathVal);
  parts.push(entry.name);
  return '/' + parts.map(encodeURIComponent).join('/');
}

// Build href for a tree
function buildTreeHref(ownerNpub: string, treeName: string): string {
  return `/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(treeName)}`;
}

export function FileBrowser() {
  // Use zustand hooks with selectors for reactive updates
  const rootHash = useAppStore(s => s.rootHash);
  const currentDirHash = useCurrentDirHash();
  const { entries } = useDirectoryEntries(currentDirHash);
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

  const viewedNpub = currentNpub;
  const inTreeView = !!currentTreeName || !!rootHash;
  const isOwnTrees = !viewedNpub || viewedNpub === userNpub;
  const canEdit = isOwnTrees || !isLoggedIn;

  // Get trees from resolver subscription
  const targetNpub = viewedNpub || userNpub;
  const trees = useTrees(targetNpub);
  const dirHash = currentDirHash ? toHex(currentDirHash) : null;
  const { uploadFiles } = useUpload();

  const navigateTo = useNavigate();

  // Keyboard focus index (separate from URL-selected file)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Sync focused index with selected entry when it changes
  const selectedIndex = selectedEntry ? entries.findIndex(ent => ent.name === selectedEntry.name) : -1;

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (entries.length === 0) return;

    const key = e.key.toLowerCase();

    // Handle Delete key - delete focused or selected item
    if ((key === 'delete' || key === 'backspace') && canEdit) {
      const targetEntry = focusedIndex >= 0 ? entries[focusedIndex] : selectedEntry;
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
      const entry = entries[focusedIndex];
      if (entry) {
        const href = buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootHash);
        navigateTo(href);
        setFocusedIndex(-1); // Clear focus after navigation
      }
      return;
    }

    if (key !== 'arrowup' && key !== 'arrowdown' && key !== 'j' && key !== 'k') return;

    e.preventDefault();

    // Start from focused index, or selected index, or -1
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
    let newIndex: number;

    if (key === 'arrowdown' || key === 'j') {
      newIndex = currentIndex < entries.length - 1 ? currentIndex + 1 : 0;
    } else {
      newIndex = currentIndex > 0 ? currentIndex - 1 : entries.length - 1;
    }

    const newEntry = entries[newIndex];
    if (newEntry) {
      if (newEntry.isTree) {
        // Directory: just focus it, don't navigate
        setFocusedIndex(newIndex);
      } else {
        // File: navigate to it and clear focus
        setFocusedIndex(-1);
        const href = buildEntryHref(newEntry, currentNpub, currentTreeName, currentPath, rootHash);
        navigateTo(href);
      }
    }
  }, [entries, focusedIndex, selectedIndex, selectedEntry, currentNpub, currentTreeName, currentPath, rootHash, navigateTo, canEdit]);

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

  // Handle external file drop on file list
  const handleFileDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const files = e.dataTransfer?.files;
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

  // Show tree list when at root (no tree selected)
  if (!inTreeView) {
    // Determine which user to show in header
    const headerNpub = viewedNpub || (isLoggedIn ? userNpub : null);
    const headerPubkey = headerNpub ? (npubToPubkey(headerNpub) || headerNpub) : null;
    // Hide header on mobile when viewing another user (ProfileView shown above)
    const hideOnMobile = viewedNpub && viewedNpub !== userNpub;

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-surface-1">
        {/* Header with user info - hidden on mobile when viewing other user's profile */}
        <div className={`h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1 ${hideOnMobile ? 'hidden lg:flex' : ''}`}>
          {headerPubkey ? (
            <Link to={`/${headerNpub}/profile`} className="no-underline min-w-0">
              <UserRow pubkey={headerPubkey} avatarSize={24} className="min-w-0" />
            </Link>
          ) : (
            <span className="text-sm text-text-2">Folders</span>
          )}
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
        <div data-testid="file-list" className="flex-1 overflow-auto">
          {trees.length === 0 && !isOwnTrees ? (
            <div className="p-8 text-center text-muted">
              Upload files to begin
            </div>
          ) : trees.length > 0 ? (
            trees.map((tree) => (
              <Link
                key={tree.key}
                to={buildTreeHref(targetNpub!, tree.name)}
                className={`p-3 border-b border-surface-2 flex items-center gap-3 cursor-pointer no-underline text-text-1 min-w-0 ${
                  currentTreeName === tree.name ? 'bg-surface-2' : 'hover:bg-surface-1'
                }`}
              >
                <span className="shrink-0 i-lucide-folder text-warning" />
                <span className="truncate" title={tree.name}>{tree.name}</span>
              </Link>
            ))
          ) : null}
        </div>
      </div>
    );
  }

  // Build the root href for ".." when at top level
  const buildRootHref = () => {
    if (viewedNpub) return `/${viewedNpub}`;
    return '/';
  };

  // Build href for a directory path
  const buildDirHref = (path: string[]): string => {
    const parts: string[] = [];

    if (currentNpub && currentTreeName) {
      parts.push(currentNpub, currentTreeName);
      parts.push(...path);
      return '/' + parts.map(encodeURIComponent).join('/');
    } else if (rootHash) {
      const hashHex = toHex(rootHash);
      parts.push('h', hashHex);
      parts.push(...path);
      return '/' + parts.map(encodeURIComponent).join('/');
    }

    parts.push(...path);
    return '/' + parts.map(encodeURIComponent).join('/');
  };

  const buildParentHref = () => buildDirHref(currentPath.slice(0, -1));
  const buildCurrentDirHref = () => buildDirHref(currentPath);

  // Display name for the root
  const rootDisplayName = currentTreeName || (rootHash ? toHex(rootHash).slice(0, 8) + '...' : '');

  // Get current directory name for display
  const currentDirName = currentPath.length > 0 ? currentPath[currentPath.length - 1] : rootDisplayName;

  // Show file browser when inside a tree
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-1">
      {/* Header with user info when viewing someone's tree */}
      {viewedNpub && (
        <div className="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
          <Link to={`/${viewedNpub}/profile`} className="no-underline min-w-0">
            <UserRow pubkey={npubToPubkey(viewedNpub) || viewedNpub} avatarSize={24} className="min-w-0" />
          </Link>
        </div>
      )}

      {/* Mobile action buttons */}
      {(dirHash || canEdit) && (
        <div className="lg:hidden px-3 py-2 border-b border-surface-3 bg-surface-1">
          <FolderActions dirHash={dirHash} canEdit={canEdit} compact />
        </div>
      )}

      {/* File list */}
      <div
        data-testid="file-list"
        className={`flex-1 overflow-auto relative outline-none ${isDraggingOver ? 'bg-accent/10' : ''}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 border-2 border-dashed border-accent rounded m-2">
            <span className="text-accent font-medium">Drop files to upload</span>
          </div>
        )}

        {/* Parent directory row - navigation and drop target */}
        <Link
          to={currentPath.length > 0 ? buildParentHref() : buildRootHref()}
          onDragOver={currentPath.length > 0 && canEdit ? handleDragOverParent : undefined}
          onDragLeave={currentPath.length > 0 && canEdit ? handleDragLeave : undefined}
          onDrop={currentPath.length > 0 && canEdit ? handleDropOnParent : undefined}
          className={`p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 ${
            dropTarget === '__parent__' ? 'bg-accent/20 border-accent' : 'hover:bg-surface-2/50'
          }`}
        >
          <span className="i-lucide-folder text-warning shrink-0" />
          <span className="truncate">..</span>
        </Link>

        {/* Current directory row */}
        <Link
          to={buildCurrentDirHref()}
          className={`p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 ${
            !selectedEntry && focusedIndex < 0 ? 'bg-surface-2' : ''
          }`}
        >
          <span className="i-lucide-folder-open text-warning shrink-0" />
          <span className="truncate">{currentDirName}</span>
        </Link>

        {entries.length === 0 ? (
          <div className="p-4 pl-6 text-center text-muted text-sm">
            {isDraggingOver ? '' : 'Empty directory'}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <Link
              key={entry.name}
              to={buildEntryHref(entry, currentNpub, currentTreeName, currentPath, rootHash)}
              draggable={canEdit}
              onDragStart={(e) => handleDragStart(e, entry.name)}
              onDragEnd={handleDragEnd}
              onDragOver={entry.isTree ? (e) => handleDragOverDir(e, entry.name) : undefined}
              onDragLeave={entry.isTree ? handleDragLeave : undefined}
              onDrop={entry.isTree ? (e) => handleDropOnDir(e, entry.name) : undefined}
              className={`p-3 pl-9 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-2/50 ${
                selectedEntry?.name === entry.name ? 'bg-surface-2' : ''
              } ${focusedIndex === idx ? 'ring-2 ring-inset ring-accent' : ''} ${
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
