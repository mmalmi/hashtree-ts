import { ReactNode, useState } from 'react';
import { useModals, closeCreateModal, closeRenameModal, closeForkModal, closeExtractModal, setModalInput } from '../hooks/useModals';
import { createFile, createFolder, createTree, renameEntry, forkTree, uploadExtractedFiles } from '../actions';

export function CreateModal() {
  const { showCreateModal, createModalType, modalInput } = useModals();

  if (!showCreateModal) return null;

  const isFolder = createModalType === 'folder';
  const isTree = createModalType === 'tree';

  const handleSubmit = () => {
    const name = modalInput.trim();
    if (!name) return;

    if (isTree) {
      createTree(name);
    } else if (isFolder) {
      createFolder(name);
    } else {
      createFile(name, '');
    }
    closeCreateModal();
  };

  const title = isTree ? 'New Folder' : isFolder ? 'New Folder' : 'New File';
  const placeholder = isTree || isFolder ? 'Folder name...' : 'File name...';

  return (
    <ModalBase
      title={title}
      onClose={closeCreateModal}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={modalInput}
        onChange={(e) => setModalInput(e.target.value)}
        className="w-full input"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
      />
      <div className="flex gap-2 mt-4">
        <button
          onClick={closeCreateModal}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button onClick={handleSubmit} className="btn-success">
          Create
        </button>
      </div>
    </ModalBase>
  );
}

export function RenameModal() {
  const { showRenameModal, renameTarget, modalInput } = useModals();

  if (!showRenameModal || !renameTarget) return null;

  const handleSubmit = () => {
    const newName = modalInput.trim();
    if (!newName || !renameTarget) return;

    renameEntry(renameTarget, newName);
    closeRenameModal();
  };

  return (
    <ModalBase
      title={`Rename: ${renameTarget}`}
      onClose={closeRenameModal}
    >
      <input
        type="text"
        placeholder="New name..."
        value={modalInput}
        onChange={(e) => setModalInput(e.target.value)}
        className="w-full input"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
      />
      <div className="flex gap-2 mt-4">
        <button
          onClick={closeRenameModal}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button onClick={handleSubmit} className="btn-success">
          Rename
        </button>
      </div>
    </ModalBase>
  );
}

export function ForkModal() {
  const { showForkModal, forkTarget, modalInput } = useModals();

  if (!showForkModal || !forkTarget) return null;

  const handleSubmit = async () => {
    const name = modalInput.trim();
    if (!name) return;

    await forkTree(forkTarget.dirCid, name);
    closeForkModal();
  };

  return (
    <ModalBase
      title="Fork as New Folder"
      onClose={closeForkModal}
    >
      <input
        type="text"
        placeholder="Folder name..."
        value={modalInput}
        onChange={(e) => setModalInput(e.target.value)}
        className="w-full input"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
      />
      <div className="flex gap-2 mt-4">
        <button
          onClick={closeForkModal}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button onClick={handleSubmit} className="btn-success">
          Fork
        </button>
      </div>
    </ModalBase>
  );
}

export function ExtractModal() {
  const { showExtractModal, extractTarget } = useModals();
  const [isExtracting, setIsExtracting] = useState(false);

  if (!showExtractModal || !extractTarget) return null;

  const { archiveName, files } = extractTarget;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const handleExtract = async () => {
    setIsExtracting(true);
    try {
      await uploadExtractedFiles(files);
      closeExtractModal();
    } catch (err) {
      console.error('Failed to extract files:', err);
      alert('Failed to extract archive');
    } finally {
      setIsExtracting(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ModalBase
      title="Extract Archive?"
      onClose={closeExtractModal}
    >
      <div className="mb-4">
        <p className="text-text-2 mb-2">
          <strong>{archiveName}</strong> contains {files.length} file{files.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
        </p>
        <div className="max-h-200px overflow-y-auto bg-surface-2 rounded p-2 text-sm">
          {files.slice(0, 20).map((f, i) => (
            <div key={i} className="flex justify-between py-0.5">
              <span className="truncate flex-1 mr-2">{f.name}</span>
              <span className="text-text-3">{formatSize(f.size)}</span>
            </div>
          ))}
          {files.length > 20 && (
            <div className="text-text-3 py-1">...and {files.length - 20} more files</div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={closeExtractModal}
          className="btn-ghost"
          disabled={isExtracting}
        >
          Keep as ZIP
        </button>
        <button
          onClick={handleExtract}
          className="btn-success"
          disabled={isExtracting}
        >
          {isExtracting ? (
            <>
              <span className="i-lucide-loader-2 animate-spin mr-1" />
              Extracting...
            </>
          ) : (
            <>
              <span className="i-lucide-archive mr-1" />
              Extract Files
            </>
          )}
        </button>
      </div>
    </ModalBase>
  );
}

function ModalBase({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex-center z-1000"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-1 rounded-lg p-6 min-w-300px border border-surface-3">
        <h3 className="mb-4 font-medium">{title}</h3>
        {children}
      </div>
    </div>
  );
}
