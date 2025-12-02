/**
 * Shared folder action buttons - used in FileBrowser and Preview
 */
import { Link } from 'react-router-dom';
import { openCreateModal, openRenameModal } from '../hooks/useModals';
import { useUpload } from '../hooks/useUpload';
import { useRoute } from '../hooks';
import { deleteCurrentFolder } from '../actions';

interface FolderActionsProps {
  dirHash?: string | null;
  canEdit: boolean;
  compact?: boolean;
}

export function FolderActions({ dirHash, canEdit, compact = false }: FolderActionsProps) {
  const { uploadFiles } = useUpload();
  const route = useRoute();

  // Check if we're in a subdirectory (not root)
  const isSubdir = route.path.length > 0;
  const currentDirName = isSubdir ? route.path[route.path.length - 1] : null;

  if (!dirHash && !canEdit) return null;

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
        <Link
          to={`/h/${dirHash}`}
          className={`btn-ghost no-underline ${btnClass}`}
          title={dirHash}
        >
          <span className="i-lucide-link" />
          Permalink
        </Link>
      )}
      {canEdit && (
        <>
          <label className={`btn-success cursor-pointer ${btnClass}`}>
            <span className="i-lucide-upload" />
            Upload
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
