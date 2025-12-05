/**
 * Modal for forking a directory as a new tree
 */
import { useModals, closeForkModal, setModalInput } from '../../hooks/useModals';
import { forkTree } from '../../actions';
import { ModalBase, ModalInput, ModalButtons } from './ModalBase';

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
    <ModalBase title="Fork as New Folder" onClose={closeForkModal}>
      <ModalInput
        value={modalInput}
        onChange={setModalInput}
        onSubmit={handleSubmit}
        placeholder="Folder name..."
      />
      <ModalButtons
        onCancel={closeForkModal}
        onSubmit={handleSubmit}
        submitText="Fork"
      />
    </ModalBase>
  );
}
