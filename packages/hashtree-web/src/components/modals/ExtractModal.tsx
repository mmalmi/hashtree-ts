/**
 * Modal for extracting archive files (ZIP, etc.)
 */
import { useState } from 'react';
import { useModals, closeExtractModal, setExtractLocation } from '../../hooks/useModals';
import { uploadExtractedFiles, uploadSingleFile } from '../../actions';
import { ModalBase, FileList, formatBytes } from './ModalBase';

export function ExtractModal() {
  const { showExtractModal, extractTarget, extractLocation } = useModals();
  const [isExtracting, setIsExtracting] = useState(false);
  const [isKeeping, setIsKeeping] = useState(false);

  if (!showExtractModal || !extractTarget) return null;

  const { archiveName, files, originalData } = extractTarget;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Get subdirectory name from archive (remove .zip extension)
  const subdirName = archiveName.replace(/\.zip$/i, '');

  const handleExtract = async () => {
    setIsExtracting(true);
    try {
      await uploadExtractedFiles(files, extractLocation === 'subdir' ? subdirName : undefined);
      closeExtractModal();
    } catch (err) {
      console.error('Failed to extract files:', err);
      alert('Failed to extract archive');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleKeepAsZip = async () => {
    if (!originalData) {
      closeExtractModal();
      return;
    }

    setIsKeeping(true);
    try {
      await uploadSingleFile(archiveName, originalData);
      closeExtractModal();
    } catch (err) {
      console.error('Failed to upload ZIP:', err);
      alert('Failed to upload archive');
    } finally {
      setIsKeeping(false);
    }
  };

  const isBusy = isExtracting || isKeeping;

  return (
    <ModalBase title="Extract Archive?" onClose={closeExtractModal}>
      <div className="mb-4">
        <p className="text-text-2 mb-2">
          <strong>{archiveName}</strong> contains {files.length} file{files.length !== 1 ? 's' : ''} ({formatBytes(totalSize)})
        </p>
        <FileList files={files} formatSize={formatBytes} />
      </div>

      {/* Extraction location picker */}
      <div className="mb-4">
        <label className="text-sm text-text-2 mb-2 block">Extract to:</label>
        <div className="flex gap-2">
          {([
            { value: 'current', label: 'Current folder', icon: 'i-lucide-folder' },
            { value: 'subdir', label: subdirName, icon: 'i-lucide-folder-plus' },
          ] as const).map(({ value, label, icon }) => {
            const isSelected = extractLocation === value;
            return (
              <button
                key={value}
                onClick={() => setExtractLocation(value)}
                disabled={isBusy}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded border ${
                  isSelected
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-surface-3 text-text-1 hover:border-surface-4 hover:bg-surface-2'
                }`}
              >
                <span className={icon} />
                <span className="text-sm truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleKeepAsZip} className="btn-ghost" disabled={isBusy}>
          {isKeeping ? (
            <>
              <span className="i-lucide-loader-2 animate-spin mr-1" />
              Uploading...
            </>
          ) : (
            'Keep as ZIP'
          )}
        </button>
        <button onClick={handleExtract} className="btn-success" disabled={isBusy}>
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
