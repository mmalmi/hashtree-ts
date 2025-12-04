/**
 * ZIP file preview component
 * Shows contents of a ZIP file and allows extraction to current dir or subdirectory
 */
import { useMemo, useState } from 'react';
import { unzipSync } from 'fflate';
import { openExtractModal, type ArchiveFile } from '../hooks/useModals';

interface ZipPreviewProps {
  data: Uint8Array;
  filename: string;
  onDownload?: () => void;
}

interface ZipEntry {
  name: string;
  size: number;
  isDirectory: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg': case 'ico': case 'bmp':
      return 'i-lucide-image';
    case 'mp4': case 'webm': case 'mkv': case 'avi': case 'mov':
      return 'i-lucide-video';
    case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a':
      return 'i-lucide-music';
    case 'exe': case 'com': case 'bat':
      return 'i-lucide-terminal';
    case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'rb': case 'go': case 'rs':
    case 'c': case 'cpp': case 'h': case 'java': case 'php': case 'sh': case 'bash':
      return 'i-lucide-file-code';
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml': case 'ini': case 'env':
      return 'i-lucide-file-json';
    case 'pdf': case 'doc': case 'docx': case 'txt': case 'md': case 'markdown': case 'rst':
      return 'i-lucide-file-text';
    case 'xls': case 'xlsx': case 'csv':
      return 'i-lucide-file-spreadsheet';
    case 'zip': case 'tar': case 'gz': case 'rar': case '7z':
      return 'i-lucide-file-archive';
    case 'html': case 'htm': case 'css': case 'scss': case 'sass': case 'less':
      return 'i-lucide-file-code';
    default:
      return 'i-lucide-file';
  }
}

export function ZipPreview({ data, filename, onDownload }: ZipPreviewProps) {
  const [error, setError] = useState<string | null>(null);

  // Parse ZIP contents
  const { entries, totalSize, unzipped } = useMemo(() => {
    try {
      const unzipped = unzipSync(data);
      const entries: ZipEntry[] = [];
      let totalSize = 0;

      for (const [name, content] of Object.entries(unzipped)) {
        // Skip Mac OS X metadata
        if (name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) {
          continue;
        }

        const isDirectory = name.endsWith('/') || content.length === 0;
        if (!isDirectory) {
          entries.push({
            name: name.replace(/\/$/, ''),
            size: content.length,
            isDirectory: false,
          });
          totalSize += content.length;
        }
      }

      // Sort entries: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return { entries, totalSize, unzipped };
    } catch {
      setError('Failed to read ZIP file');
      return { entries: [], totalSize: 0, unzipped: null };
    }
  }, [data]);

  const handleExtract = () => {
    if (!unzipped) return;

    // Convert to ArchiveFile format
    const archiveFiles: ArchiveFile[] = [];
    for (const [name, content] of Object.entries(unzipped)) {
      // Skip Mac OS X metadata and directories
      if (name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) {
        continue;
      }
      if (name.endsWith('/') || content.length === 0) {
        continue;
      }
      archiveFiles.push({
        name,
        data: content,
        size: content.length,
      });
    }

    // Open extract modal with the files (no originalData since ZIP already exists)
    openExtractModal(filename, archiveFiles);
  };

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4">
        <span className="i-lucide-file-warning text-4xl text-danger mb-2" />
        <span className="text-danger">{error}</span>
        {onDownload && (
          <button onClick={onDownload} className="btn-ghost mt-4">
            Download file
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <span className="i-lucide-file-archive text-2xl text-accent" />
          <div>
            <div className="font-medium">{filename}</div>
            <div className="text-sm text-text-2">
              {entries.length} file{entries.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
            </div>
          </div>
        </div>
        <button
          onClick={handleExtract}
          className="btn-success flex items-center gap-2"
          disabled={entries.length === 0}
        >
          <span className="i-lucide-archive" />
          Extract
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto bg-surface-2 rounded-lg border border-surface-3">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-3">
            Empty archive
          </div>
        ) : (
          <div className="divide-y divide-surface-3">
            {entries.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 hover:bg-surface-3/50"
              >
                <span className={`${getFileIcon(entry.name)} text-text-2 shrink-0`} />
                <span className="flex-1 truncate text-sm">{entry.name}</span>
                <span className="text-text-3 text-sm shrink-0">{formatSize(entry.size)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
