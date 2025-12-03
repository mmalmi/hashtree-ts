/**
 * Shared folder action buttons - used in FileBrowser and Preview
 */
import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { nhashEncode, toHex } from 'hashtree';
import type { CID } from 'hashtree';
import { openCreateModal, openRenameModal, openForkModal } from '../hooks/useModals';
import { useUpload } from '../hooks/useUpload';
import { useRoute, useTrees } from '../hooks';
import { deleteCurrentFolder } from '../actions';
import { useNostrStore } from '../nostr';
import { getTree } from '../store';
import { createZipFromDirectory, downloadBlob } from '../utils/compression';
import { readFilesFromWebkitDirectory, supportsDirectoryUpload } from '../utils/directory';

interface FolderActionsProps {
  dirCid?: CID | null;
  canEdit: boolean;
  compact?: boolean;
}

// Suggest a fork name - use dirName unless it already exists as a top-level tree
function suggestForkName(dirName: string, existingTreeNames: string[]): string {
  if (!existingTreeNames.includes(dirName)) {
    return dirName;
  }
  // Add suffix to find unique name
  let i = 2;
  while (existingTreeNames.includes(`${dirName}-${i}`)) {
    i++;
  }
  return `${dirName}-${i}`;
}

export function FolderActions({ dirCid, canEdit, compact = false }: FolderActionsProps) {
  const { uploadFiles, uploadFilesWithPaths } = useUpload();
  const route = useRoute();
  const userNpub = useNostrStore(s => s.npub);
  const [isDownloading, setIsDownloading] = useState(false);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const hasDirectorySupport = supportsDirectoryUpload();

  // Get user's own trees for fork name suggestions
  const ownTrees = useTrees(userNpub);
  const ownTreeNames = ownTrees.map(t => t.name);

  // Check if we're in a subdirectory (not root)
  const isSubdir = route.path.length > 0;
  const currentDirName = isSubdir ? route.path[route.path.length - 1] : null;

  // Convert CID to hex hash for links that need it
  const dirHash = dirCid ? toHex(dirCid.hash) : null;

  // For fork, use current dir name or tree name as suggestion
  const forkBaseName = currentDirName || route.treeName || 'folder';

  // Handle fork button click
  const handleFork = () => {
    if (!dirCid) return;
    const suggestedName = suggestForkName(forkBaseName, ownTreeNames);
    openForkModal(dirCid, suggestedName);
  };

  // Handle download as ZIP
  const handleDownloadZip = async () => {
    if (!dirCid || isDownloading) return;
    setIsDownloading(true);
    try {
      const tree = getTree();
      const zipData = await createZipFromDirectory(tree, dirCid, forkBaseName);
      const zipName = `${forkBaseName}.zip`;
      downloadBlob(zipData, zipName, 'application/zip');
    } catch (err) {
      console.error('Failed to create ZIP:', err);
      alert('Failed to create ZIP file');
    } finally {
      setIsDownloading(false);
    }
  };

  if (!dirCid && !canEdit) return null;

  // Build stream URL if in tree context
  const streamUrl = route.npub && route.treeName
    ? `/${route.npub}/${route.treeName}/stream`
    : null;

  const btnClass = compact
    ? 'flex items-center gap-1 px-3 py-1.5 text-xs'
    : 'flex items-center gap-1 px-3 py-2 text-sm';

  return (
    <div className="flex flex-row flex-wrap items-center gap-2">
      {dirHash && (
        <>
          {/* Permalink to this directory's hash */}
          <Link
            to={`/${nhashEncode(dirHash)}`}
            className={`btn-ghost no-underline ${btnClass}`}
            title={dirHash}
          >
            <span className="i-lucide-link" />
            Permalink
          </Link>
          <button onClick={handleFork} className={`btn-ghost ${btnClass}`} title="Fork as new top-level folder">
            <span className="i-lucide-git-fork" />
            Fork
          </button>
          <button
            onClick={handleDownloadZip}
            disabled={isDownloading}
            className={`btn-ghost ${btnClass}`}
            title="Download directory as ZIP"
          >
            <span className={isDownloading ? "i-lucide-loader-2 animate-spin" : "i-lucide-archive"} />
            {isDownloading ? 'Zipping...' : 'ZIP'}
          </button>
        </>
      )}
      {canEdit && (
        <>
          <label className={`btn-success cursor-pointer ${btnClass}`}>
            <span className="i-lucide-plus" />
            Add
            <input
              type="file"
              multiple
              onChange={(e) => {
                const input = e.target as HTMLInputElement;
                if (input.files) uploadFiles(input.files);
                input.value = '';
              }}
              className="hidden"
            />
          </label>

          {hasDirectorySupport && (
            <label className={`btn-ghost cursor-pointer ${btnClass}`} title="Add a folder with all its contents">
              <span className="i-lucide-folder-plus" />
              Add Dir
              <input
                ref={dirInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is not in the standard types
                webkitdirectory=""
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  if (input.files && input.files.length > 0) {
                    const filesWithPaths = readFilesFromWebkitDirectory(input.files);
                    uploadFilesWithPaths(filesWithPaths);
                  }
                  input.value = '';
                }}
                className="hidden"
              />
            </label>
          )}

          <button onClick={() => openCreateModal('file')} className={`btn-ghost ${btnClass}`}>
            <span className="i-lucide-file-plus" />
            File
          </button>

          <button onClick={() => openCreateModal('folder')} className={`btn-ghost ${btnClass}`}>
            <span className="i-lucide-folder-plus" />
            Folder
          </button>

          {streamUrl && (
            <Link to={streamUrl} className={`btn-ghost no-underline ${btnClass}`}>
              <span className="i-lucide-video" />
              Stream
            </Link>
          )}

          {isSubdir && currentDirName && (
            <>
              <button onClick={() => openRenameModal(currentDirName)} className={`btn-ghost ${btnClass}`}>
                Rename
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete folder "${currentDirName}" and all its contents?`)) {
                    deleteCurrentFolder();
                  }
                }}
                className={`btn-ghost text-danger ${btnClass}`}
              >
                Delete
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
