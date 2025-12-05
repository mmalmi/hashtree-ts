/**
 * Shared modal base component and utilities
 */
import { type ReactNode } from 'react';

export interface ModalBaseProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Optional max width class, defaults to min-w-300px */
  widthClass?: string;
}

/**
 * Base modal wrapper with backdrop and close-on-click-outside
 */
export function ModalBase({ title, children, onClose, widthClass = 'min-w-300px' }: ModalBaseProps) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex-center z-1000"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-surface-1 rounded-lg p-6 ${widthClass} border border-surface-3`}>
        <h3 className="mb-4 font-medium">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * Standard modal button row with cancel and submit
 */
export function ModalButtons({
  onCancel,
  onSubmit,
  cancelText = 'Cancel',
  submitText = 'Submit',
  isLoading = false,
  loadingText,
  disabled = false,
  submitIcon,
  submitClass = 'btn-success',
}: {
  onCancel: () => void;
  onSubmit: () => void;
  cancelText?: string;
  submitText?: string;
  isLoading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  submitIcon?: string;
  submitClass?: string;
}) {
  return (
    <div className="flex gap-2 mt-4">
      <button onClick={onCancel} className="btn-ghost" disabled={isLoading}>
        {cancelText}
      </button>
      <button onClick={onSubmit} className={submitClass} disabled={disabled || isLoading}>
        {isLoading ? (
          <>
            <span className="i-lucide-loader-2 animate-spin mr-1" />
            {loadingText || submitText}
          </>
        ) : (
          <>
            {submitIcon && <span className={`${submitIcon} mr-1`} />}
            {submitText}
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Text input for modals with Enter key submit
 */
export function ModalInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full input"
      autoFocus={autoFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit();
      }}
    />
  );
}

/**
 * File list display for archive/gitignore modals
 */
export function FileList({
  files,
  maxVisible = 20,
  formatSize,
}: {
  files: { name: string; size: number }[];
  maxVisible?: number;
  formatSize: (bytes: number) => string;
}) {
  return (
    <div className="max-h-150px overflow-y-auto bg-surface-2 rounded p-2 text-sm">
      {files.slice(0, maxVisible).map((f, i) => (
        <div key={i} className="flex justify-between py-0.5">
          <span className="truncate flex-1 mr-2">{f.name}</span>
          <span className="text-text-3">{formatSize(f.size)}</span>
        </div>
      ))}
      {files.length > maxVisible && (
        <div className="text-text-3 py-1">...and {files.length - maxVisible} more files</div>
      )}
    </div>
  );
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
