import { ReactNode } from 'react';
import { useModals, closeCreateModal, closeRenameModal, closeForkModal, setModalInput } from '../hooks/useModals';
import { createFile, createFolder, createTree, renameEntry, forkTree } from '../actions';

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

    await forkTree(forkTarget.dirHash, name);
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
