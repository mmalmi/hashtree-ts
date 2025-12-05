/**
 * Toast - unified toast notification system
 * Shows upload progress and general notifications at bottom of screen
 */
import { useUploadProgress, cancelUpload } from '../hooks/useUpload';
import { useToasts, dismissToast, type ToastType } from '../stores/toast';

const iconMap: Record<ToastType, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-check-circle',
  error: 'i-lucide-x-circle',
  warning: 'i-lucide-alert-triangle',
};

const colorMap: Record<ToastType, string> = {
  info: 'text-accent',
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
};

export function Toast() {
  const uploadProgress = useUploadProgress();
  const toasts = useToasts();

  const hasContent = uploadProgress || toasts.length > 0;
  if (!hasContent) return null;

  const percent = uploadProgress?.totalBytes
    ? Math.round((uploadProgress.bytes || 0) / uploadProgress.totalBytes * 100)
    : uploadProgress ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0;

  return (
    <div
      className="pointer-events-none flex flex-col items-center gap-2"
      style={{ position: 'fixed', bottom: '1rem', left: '1rem', right: '1rem', zIndex: 9999 }}
    >
      {/* Regular toasts */}
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-surface-1 border border-surface-3 rounded-lg shadow-lg p-3 max-w-sm w-full flex items-start gap-2"
        >
          <span className={`${iconMap[toast.type]} ${colorMap[toast.type]} shrink-0 mt-0.5`} />
          <span className="text-sm text-text-1 flex-1">{toast.message}</span>
          <button
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 text-text-3 hover:text-text-1 transition-colors"
          >
            <span className="i-lucide-x text-sm" />
          </button>
        </div>
      ))}

      {/* Upload progress toast */}
      {uploadProgress && (
        <div className="pointer-events-auto bg-surface-1 border border-accent rounded-lg shadow-lg p-3 max-w-sm w-full">
          {/* Header with filename and cancel */}
          <div className="flex items-center gap-2 mb-2">
            <span className="i-lucide-loader-2 animate-spin text-accent shrink-0" />
            <span className="text-sm text-text-1 truncate flex-1">{uploadProgress.fileName}</span>
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
            {uploadProgress.current} / {uploadProgress.total}
          </div>
        </div>
      )}
    </div>
  );
}
