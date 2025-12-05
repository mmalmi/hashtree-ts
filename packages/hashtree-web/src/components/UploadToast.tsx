/**
 * UploadToast - global floating upload progress indicator
 * Shows at bottom of screen during file uploads
 */
import { useUploadProgress, cancelUpload } from '../hooks/useUpload';

export function UploadToast() {
  const progress = useUploadProgress();

  if (!progress) return null;

  const percent = progress.totalBytes
    ? Math.round((progress.bytes || 0) / progress.totalBytes * 100)
    : Math.round((progress.current / progress.total) * 100);

  return (
    <div
      className="pointer-events-none flex justify-center"
      style={{ position: 'fixed', bottom: '1rem', left: '1rem', right: '1rem', zIndex: 9999 }}
    >
      <div className="pointer-events-auto bg-surface-1 border border-accent rounded-lg shadow-lg p-3 max-w-sm w-full">
        {/* Header with filename and cancel */}
        <div className="flex items-center gap-2 mb-2">
          <span className="i-lucide-loader-2 animate-spin text-accent shrink-0" />
          <span className="text-sm text-text-1 truncate flex-1">{progress.fileName}</span>
          <button
            onClick={cancelUpload}
            className="shrink-0 px-2 py-0.5 text-xs text-text-3 hover:text-text-1 transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden mb-1">
          <div
            className="h-full bg-accent transition-all duration-150"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Count */}
        <div className="text-xs text-text-3 text-right">
          {progress.current} / {progress.total}
        </div>
      </div>
    </div>
  );
}
