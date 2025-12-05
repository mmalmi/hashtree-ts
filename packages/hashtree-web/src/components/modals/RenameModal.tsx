/**
 * Modal for renaming files and folders
 */
import { useModals, closeRenameModal, setModalInput } from '../../hooks/useModals';
import { renameEntry } from '../../actions';
import { ModalBase, ModalInput, ModalButtons } from './ModalBase';

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
    <ModalBase title={`Rename: ${renameTarget}`} onClose={closeRenameModal}>
      <ModalInput
        value={modalInput}
        onChange={setModalInput}
        onSubmit={handleSubmit}
        placeholder="New name..."
      />
      <ModalButtons
        onCancel={closeRenameModal}
        onSubmit={handleSubmit}
        submitText="Rename"
      />
    </ModalBase>
  );
}
