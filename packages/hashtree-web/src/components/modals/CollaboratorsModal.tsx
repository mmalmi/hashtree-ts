/**
 * CollaboratorsModal - manage collaborator npubs for Yjs documents
 */
import { useState, useEffect } from 'react';
import { useModals, closeCollaboratorsModal } from '../../hooks/useModals';

export function CollaboratorsModal() {
  const { showCollaboratorsModal, collaboratorsTarget } = useModals();
  const [npubs, setNpubs] = useState<string[]>([]);
  const [newNpub, setNewNpub] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Initialize state when modal opens
  useEffect(() => {
    if (showCollaboratorsModal && collaboratorsTarget) {
      setNpubs([...collaboratorsTarget.npubs]);
      setNewNpub('');
      setError(null);
    }
  }, [showCollaboratorsModal, collaboratorsTarget]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showCollaboratorsModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement)?.blur();
        closeCollaboratorsModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCollaboratorsModal]);

  if (!showCollaboratorsModal || !collaboratorsTarget) return null;

  const handleAdd = () => {
    const trimmed = newNpub.trim();
    if (!trimmed) return;

    // Validate npub format
    if (!trimmed.startsWith('npub1') || trimmed.length !== 63) {
      setError('Invalid npub format. Must start with npub1 and be 63 characters.');
      return;
    }

    // Check for duplicates
    if (npubs.includes(trimmed)) {
      setError('This npub is already in the list.');
      return;
    }

    setNpubs([...npubs, trimmed]);
    setNewNpub('');
    setError(null);
  };

  const handleRemove = (index: number) => {
    setNpubs(npubs.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    collaboratorsTarget.onSave(npubs);
    closeCollaboratorsModal();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex-center z-1000 overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCollaboratorsModal();
      }}
    >
      <div className="bg-surface-1 rounded-lg w-full max-w-md border border-surface-3 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-3">
          <h2 className="text-lg font-semibold">Collaborators</h2>
          <button
            onClick={closeCollaboratorsModal}
            className="btn-ghost p-1"
            aria-label="Close"
          >
            <span className="i-lucide-x text-lg" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted">
            Add collaborators by their npub to merge their edits into this document.
          </p>

          {/* Current collaborators list */}
          {npubs.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Current collaborators:</label>
              <ul className="space-y-1">
                {npubs.map((npub, index) => (
                  <li key={index} className="flex items-center gap-2 bg-surface-2 rounded px-3 py-2">
                    <span className="i-lucide-user text-muted" />
                    <span className="flex-1 text-sm font-mono truncate">{npub}</span>
                    <button
                      onClick={() => handleRemove(index)}
                      className="btn-ghost p-1 text-danger"
                      title="Remove collaborator"
                    >
                      <span className="i-lucide-x" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {npubs.length === 0 && (
            <div className="text-sm text-muted bg-surface-2 rounded px-3 py-2">
              No collaborators yet. Add one below.
            </div>
          )}

          {/* Add new collaborator */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Add collaborator:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newNpub}
                onChange={(e) => {
                  setNewNpub(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="npub1..."
                className="input flex-1 font-mono text-sm"
              />
              <button
                onClick={handleAdd}
                className="btn-success px-3"
                disabled={!newNpub.trim()}
              >
                Add
              </button>
            </div>
            {error && (
              <p className="text-sm text-danger">{error}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-surface-3">
          <button onClick={closeCollaboratorsModal} className="btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-success">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
