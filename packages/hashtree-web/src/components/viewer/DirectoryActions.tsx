/**
 * DirectoryActions - empty state with upload zone and README display
 * Also handles special directory types like .yjs documents and git repos
 */
import { useState, useEffect, useRef } from 'react';
import Markdown from 'markdown-to-jsx';
import { getTree, decodeAsText } from '../../store';
import { selectFile } from '../../actions';
import { useNostrStore } from '../../nostr';
import { useRoute, useCurrentDirCid, useDirectoryEntries, useTreeRoot, useTrees, useCurrentPath } from '../../hooks';
import { useGitInfo } from '../../hooks/useGit';
import { FolderActions } from '../FolderActions';
import { useUpload } from '../../hooks/useUpload';
import { YjsDocument } from '../YjsDocument';
import { GitRepoView } from './GitRepoView';

export function DirectoryActions() {
  const rootCid = useTreeRoot();
  const rootHash = rootCid?.hash ?? null;
  const currentDirCid = useCurrentDirCid();
  const { entries } = useDirectoryEntries(currentDirCid);
  const currentPath = useCurrentPath();
  const route = useRoute();
  const viewedNpub = route.npub;
  const currentTreeName = route.treeName;
  const userNpub = useNostrStore(s => s.npub);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);
  const { uploadFiles } = useUpload();

  // Get current tree for visibility info
  const targetNpub = viewedNpub || userNpub;
  const trees = useTrees(targetNpub);
  const currentTree = currentTreeName ? trees.find(t => t.name === currentTreeName) : null;

  const canEdit = !viewedNpub || viewedNpub === userNpub || !isLoggedIn;
  // Show actions if we have a tree OR we're in a tree context (empty tree that hasn't been created yet)
  const hasTreeContext = rootHash !== null || (route.treeName !== null && canEdit);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if current directory contains a .yjs file (indicates Yjs document directory)
  const yjsConfigFile = entries.find(e => e.name === '.yjs' && !e.isTree);
  const isYjsDoc = !!yjsConfigFile;

  // Check if current directory is a git repo
  const gitInfo = useGitInfo(currentDirCid);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Handle external file drop
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleFileDragOver = (e: React.DragEvent) => {
    if (!canEdit) return;
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingOver(true);
    }
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
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

  // Find and load README.md
  useEffect(() => {
    setReadmeContent(null);
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && !e.isTree
    );
    if (!readmeEntry) return;

    let cancelled = false;
    // readFile takes CID directly
    getTree().readFile(readmeEntry.cid).then(data => {
      if (!cancelled && data) {
        const text = decodeAsText(data);
        if (text) setReadmeContent(text);
      }
    });
    return () => { cancelled = true; };
  }, [entries]);

  // If this is a .yjs directory, render the YjsDocument viewer
  // Use a key based on document identity (npub + treeName + path) to force remount when navigating
  // between different documents.
  // Note: We don't require rootCid here - YjsDocument handles its own loading state.
  // This prevents the component from remounting when rootCid updates (which causes loading spinner).
  if (isYjsDoc && currentDirCid) {
    const docKey = `${viewedNpub || userNpub || 'local'}/${route.treeName || ''}/${currentPath.join('/')}`;
    return <YjsDocument key={docKey} dirCid={currentDirCid} entries={entries} />;
  }

  // If this is a git repo, show GitHub-style directory listing with README
  if (gitInfo.isRepo && currentDirCid) {
    return <GitRepoView dirCid={currentDirCid} entries={entries} canEdit={canEdit} />;
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* Action buttons - hide when viewing locked unlisted/private directory */}
      {hasTreeContext && !(rootCid?.hash && !rootCid?.key && currentTree && (currentTree.visibility === 'unlisted' || currentTree.visibility === 'private')) && (
        <div className="p-3 shrink-0">
          <FolderActions dirCid={currentDirCid ?? undefined} canEdit={canEdit} />
        </div>
      )}

      {/* Upload drop zone */}
      {hasTreeContext && canEdit && !readmeContent && (
        <div
          className={`flex-1 mx-3 mb-3 flex items-center justify-center cursor-pointer transition-colors border border-surface-3 rounded-lg ${isDraggingOver ? 'bg-surface-1/50' : 'hover:bg-surface-1/50'}`}
          onClick={openFilePicker}
        >
          <div className="flex flex-col items-center text-text-3">
            <span className="i-lucide-plus text-4xl mb-2" />
            <span className="text-sm">Drop or click to add</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>
      )}

      {/* README.md content */}
      {readmeContent && (
        <div className="flex-1 overflow-auto px-4 pb-4 lg:px-8 lg:pb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-text-2 text-sm font-medium">README.md</span>
            {canEdit && (
              <button
                onClick={() => {
                  const readmeEntry = entries.find(
                    e => e.name.toLowerCase() === 'readme.md' && !e.isTree
                  );
                  if (readmeEntry) {
                    selectFile(readmeEntry);
                  }
                }}
                className="btn-ghost text-xs px-2 py-1"
              >
                Edit
              </button>
            )}
          </div>
          <div className="prose prose-sm max-w-none text-text-1">
            <Markdown>{readmeContent}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
