/**
 * Viewer utility functions - MIME types, file icons, and helpers
 */

// Debounce hook
import { useRef, useCallback } from 'react';

export function useDebounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Store latest fn in ref to avoid stale closures
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as T;
}

export function getMimeType(filename?: string): string | null {
  if (!filename) return null;

  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',

    // PDF
    pdf: 'application/pdf',

    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',

    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    m4a: 'audio/mp4',

    // HTML
    html: 'text/html',
    htm: 'text/html',
  };

  return ext ? mimeTypes[ext] || null : null;
}

export function isInlineViewable(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf'
  );
}

// Get icon class based on file extension
export function getFileIcon(filename: string): string {
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

export function isLikelyTextFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return true; // No extension - assume text
  const textExtensions = new Set([
    'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less',
    'html', 'htm', 'xml', 'svg', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
    'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'rs', 'go', 'java', 'c', 'cpp',
    'h', 'hpp', 'cs', 'php', 'pl', 'lua', 'vim', 'sql', 'graphql', 'prisma',
    'env', 'gitignore', 'dockerignore', 'editorconfig', 'prettierrc', 'eslintrc',
    'log', 'csv', 'tsv', 'lock', 'map'
  ]);
  return textExtensions.has(ext);
}
