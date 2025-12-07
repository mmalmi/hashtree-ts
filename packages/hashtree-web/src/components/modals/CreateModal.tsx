/**
 * Modal for creating new files, folders, or trees
 */
import { useState } from 'react';
import type { TreeVisibility } from 'hashtree';
import { useModals, closeCreateModal, setModalInput, setCreateTreeVisibility } from '../../hooks/useModals';
import { createFile, createFolder, createTree, createDocument } from '../../actions';
import { getVisibilityInfo, VisibilityIcon } from '../VisibilityIcon';
import { ModalBase, ModalInput, ModalButtons } from './ModalBase';
import { useRoute } from '../../hooks';

export function CreateModal() {
  const { showCreateModal, createModalType, createTreeVisibility, modalInput } = useModals();
  const [isCreating, setIsCreating] = useState(false);
  const route = useRoute();

  if (!showCreateModal) return null;

  const isFolder = createModalType === 'folder';
  const isTree = createModalType === 'tree';
  const isDocument = createModalType === 'document';

  const handleSubmit = async () => {
    const name = modalInput.trim();
    if (!name || isCreating) return;

    if (isTree) {
      setIsCreating(true);
      await createTree(name, createTreeVisibility);
      setIsCreating(false);
      closeCreateModal();
    } else if (isDocument) {
      // Create a document folder with .yjs config file inside
      await createDocument(name);
      closeCreateModal();
      // Navigate into the new document folder
      if (route.npub && route.treeName) {
        const newPath = [...route.path, name].map(encodeURIComponent).join('/');
        const linkKeyParam = route.linkKey ? `?k=${route.linkKey}` : '';
        window.location.hash = `/${route.npub}/${route.treeName}/${newPath}${linkKeyParam}`;
      }
    } else if (isFolder) {
      createFolder(name);
      closeCreateModal();
    } else {
      createFile(name, '');
      closeCreateModal();
    }
  };

  const title = isTree ? 'New Folder' : isDocument ? 'New Document' : isFolder ? 'New Folder' : 'New File';
  const placeholder = isDocument ? 'Document name...' : (isTree || isFolder ? 'Folder name...' : 'File name...');

  return (
    <ModalBase title={title} onClose={closeCreateModal}>
      <ModalInput
        value={modalInput}
        onChange={setModalInput}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />

      {/* Visibility picker for trees */}
      {isTree && (
        <div className="mt-4">
          <label className="text-sm text-text-2 mb-2 block">Visibility</label>
          <div className="flex gap-2">
            {(['public', 'unlisted', 'private'] as TreeVisibility[]).map((vis) => {
              const { title } = getVisibilityInfo(vis);
              const isSelected = createTreeVisibility === vis;
              return (
                <button
                  key={vis}
                  onClick={() => setCreateTreeVisibility(vis)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded border ${
                    isSelected
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-surface-3 text-text-1 hover:border-surface-4 hover:bg-surface-2'
                  }`}
                  title={title}
                >
                  <VisibilityIcon visibility={vis} />
                  <span className="text-sm capitalize">{vis}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-text-3 mt-2">
            {createTreeVisibility === 'public' && 'Anyone can browse this folder'}
            {createTreeVisibility === 'unlisted' && 'Only accessible with a special link'}
            {createTreeVisibility === 'private' && 'Only you can access this folder'}
          </p>
        </div>
      )}

      <ModalButtons
        onCancel={closeCreateModal}
        onSubmit={handleSubmit}
        submitText="Create"
        isLoading={isCreating}
        loadingText="Creating..."
      />
    </ModalBase>
  );
}
