/**
 * UnsavedChangesModal - confirm save/discard when closing editor with unsaved changes
 */
import { useState } from 'react';
import { useModals, closeUnsavedChangesModal } from '../../hooks/useModals';
import { ModalBase } from './ModalBase';

export function UnsavedChangesModal() {
  const { showUnsavedChangesModal, unsavedChangesTarget } = useModals();
  const [isSaving, setIsSaving] = useState(false);

  if (!showUnsavedChangesModal || !unsavedChangesTarget) return null;

  const { onSave, onDiscard, fileName } = unsavedChangesTarget;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
      closeUnsavedChangesModal();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    onDiscard();
    closeUnsavedChangesModal();
  };

  return (
    <ModalBase title="Unsaved Changes" onClose={closeUnsavedChangesModal}>
      <p className="text-sm text-text-2 mb-4">
        {fileName ? (
          <>Do you want to save changes to <span className="font-medium text-text-1">{fileName}</span>?</>
        ) : (
          'Do you want to save your changes?'
        )}
      </p>

      <div className="flex justify-end gap-2">
        <button
          onClick={closeUnsavedChangesModal}
          className="btn-ghost"
        >
          Cancel
        </button>
        <button
          onClick={handleDiscard}
          className="btn-ghost text-danger"
        >
          Don't Save
        </button>
        <button
          onClick={handleSave}
          className="btn-success"
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </ModalBase>
  );
}
