/**
 * Modal for handling .gitignore detection in directory uploads
 */
import { useState } from 'react';
import { useModals, closeGitignoreModal } from '../../hooks/useModals';
import { ModalBase, formatBytes } from './ModalBase';

export function GitignoreModal() {
  const { showGitignoreModal, gitignoreTarget } = useModals();
  const [rememberChoice, setRememberChoice] = useState(false);

  if (!showGitignoreModal || !gitignoreTarget) return null;

  const { allFiles, includedFiles, excludedFiles, dirName, onDecision } = gitignoreTarget;
  const excludedSize = excludedFiles.reduce((sum, f) => sum + f.file.size, 0);

  const handleUseGitignore = () => {
    onDecision(true, rememberChoice);
    closeGitignoreModal();
  };

  const handleUploadAll = () => {
    onDecision(false, rememberChoice);
    closeGitignoreModal();
  };

  const handleClose = () => {
    onDecision(false, false);
    closeGitignoreModal();
  };

  return (
    <ModalBase title=".gitignore Detected" onClose={handleClose}>
      <div className="mb-4">
        <p className="text-text-2 mb-3">
          Found <strong>.gitignore</strong> in <strong>{dirName}</strong>.
          Skip {excludedFiles.length} ignored file{excludedFiles.length !== 1 ? 's' : ''} ({formatBytes(excludedSize)})?
        </p>

        {/* Show some excluded files */}
        {excludedFiles.length > 0 && (
          <div className="mb-3">
            <div className="text-sm text-text-3 mb-1">Files to skip:</div>
            <div className="max-h-120px overflow-y-auto bg-surface-2 rounded p-2 text-sm">
              {excludedFiles.slice(0, 15).map((f, i) => (
                <div key={i} className="flex justify-between py-0.5 text-text-3">
                  <span className="truncate flex-1 mr-2">{f.relativePath}</span>
                  <span>{formatBytes(f.file.size)}</span>
                </div>
              ))}
              {excludedFiles.length > 15 && (
                <div className="text-text-3 py-1">...and {excludedFiles.length - 15} more</div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-text-2 bg-surface-2 rounded p-2">
          <span className="i-lucide-info text-accent" />
          <span>
            Will upload {includedFiles.length} of {allFiles.length} files
          </span>
        </div>
      </div>

      {/* Remember choice checkbox */}
      <label className="flex items-center gap-2 mb-4 cursor-pointer text-sm text-text-2">
        <input
          type="checkbox"
          checked={rememberChoice}
          onChange={(e) => setRememberChoice(e.target.checked)}
          className="w-4 h-4 accent-accent"
        />
        <span>Remember my choice</span>
      </label>

      <div className="flex gap-2">
        <button onClick={handleUploadAll} className="btn-ghost">
          Upload All
        </button>
        <button onClick={handleUseGitignore} className="btn-success">
          <span className="i-lucide-filter mr-1" />
          Skip Ignored
        </button>
      </div>
    </ModalBase>
  );
}
