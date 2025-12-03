import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Markdown from 'markdown-to-jsx';
import { toHex, fromHex, nhashEncode } from 'hashtree';
import { Avatar } from './user';
import { npubToPubkey } from '../nostr';
import { LiveVideo, LiveVideoFromHash } from './LiveVideo';
import { StreamView } from './stream';
import { FolderActions } from './FolderActions';
import {
  useAppStore,
  formatBytes,
  decodeAsText,
  getTree,
} from '../store';
import { saveFile, deleteEntry, selectFile } from '../actions';
import { openRenameModal } from '../hooks/useModals';
import { useNostrStore } from '../nostr';
import { useSelectedFile, useRoute, useCurrentDirHash, useCurrentDirCid, useDirectoryEntries } from '../hooks';
import { useUpload } from '../hooks/useUpload';
import { getResolverKey } from '../refResolver';
import { useRecentlyChanged } from '../hooks/useRecentlyChanged';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

// Debounce hook
function useDebounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]) as T;
}

export function Viewer() {
  const navigate = useNavigate();
  const location = useLocation();
  const rootCid = useAppStore(s => s.rootCid);
  const rootHash = rootCid?.hash ?? null;
  const currentDirCid = useCurrentDirCid();
  const { entries } = useDirectoryEntries(currentDirCid);

  const route = useRoute();
  const viewedNpub = route.npub;
  const currentTreeName = route.treeName;
  const userNpub = useNostrStore(s => s.npub);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);

  // Get filename from URL path directly (last segment)
  const urlFileName = route.path.length > 0 ? route.path[route.path.length - 1] : null;
  const currentPath = route.path.slice(0, -1); // Directory path excludes filename

  // Find entry in current entries list (for metadata like hash)
  const entryFromStore = useMemo(() => {
    if (!urlFileName) return null;
    return entries.find(e => e.name === urlFileName && !e.isTree) || null;
  }, [urlFileName, entries]);

  // File state - content loaded from hash
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const showLoading = useDelayedLoading(loading);
  const [fileHash, setFileHash] = useState<Uint8Array | null>(null);
  const [resolvedEntry, setResolvedEntry] = useState<{ name: string; hash: Uint8Array; size?: number } | null>(null);

  // Use store entry if available, otherwise use resolved entry
  const entry = entryFromStore || resolvedEntry;

  // Resolve file hash from path when store entry is not available
  useEffect(() => {
    if (entryFromStore) {
      setResolvedEntry(null);
      return;
    }

    // For permalinks without path, check if rootHash itself is a file
    if (route.isPermalink && !urlFileName && rootHash) {
      let cancelled = false;
      const tree = getTree();
      tree.isDirectory(rootHash).then(isDir => {
        if (!cancelled && !isDir) {
          // The rootHash is the file itself
          setResolvedEntry({ name: 'file', hash: rootHash });
        }
      });
      return () => { cancelled = true; };
    }

    if (!urlFileName || !rootHash) {
      setResolvedEntry(null);
      return;
    }

    let cancelled = false;
    const tree = getTree();

    // For permalinks with path, check if rootHash itself is a file (not a directory)
    // In that case, the path is just the filename for display purposes
    if (route.isPermalink) {
      tree.isDirectory(rootHash).then(isDir => {
        if (!cancelled && !isDir) {
          // The rootHash is the file itself, use urlFileName for display
          setResolvedEntry({ name: urlFileName, hash: rootHash });
        } else if (!cancelled && isDir) {
          // It's a directory, resolve the path within it
          const fullPath = [...currentPath, urlFileName].join('/');
          tree.resolvePath(rootHash, fullPath).then(async hash => {
            if (!cancelled && hash) {
              const isFileDir = await tree.isDirectory(hash);
              if (!cancelled && !isFileDir) {
                setResolvedEntry({ name: urlFileName, hash });
              }
            }
          });
        }
      });
    } else {
      // Non-permalink: resolve path normally
      const fullPath = [...currentPath, urlFileName].join('/');
      tree.resolvePath(rootHash, fullPath).then(async hash => {
        if (!cancelled && hash) {
          const isDir = await tree.isDirectory(hash);
          if (!cancelled && !isDir) {
            setResolvedEntry({ name: urlFileName, hash });
          }
        }
      });
    }

    return () => { cancelled = true; };
  }, [entryFromStore, urlFileName, rootHash, currentPath.join('/'), route.isPermalink]);

  // Parse query params from location.search (works with hash routing)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // Edit mode is driven by URL query param
  const isEditing = searchParams.get('edit') === '1';
  const isFullscreen = searchParams.get('fullscreen') === '1';
  const [editContent, setEditContent] = useState('');
  const [autoSave, setAutoSave] = useState(false);

  // Helper to update URL query params
  const setUrlParam = useCallback((param: string, value: boolean) => {
    const hash = window.location.hash.split('?')[0];
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (value) {
      params.set(param, '1');
    } else {
      params.delete(param);
    }
    const queryString = params.toString();
    window.location.hash = queryString ? `${hash}?${queryString}` : hash;
  }, []);

  const setIsEditing = useCallback((editing: boolean) => setUrlParam('edit', editing), [setUrlParam]);
  const setIsFullscreen = useCallback((fullscreen: boolean) => setUrlParam('fullscreen', fullscreen), [setUrlParam]);

  const mimeType = urlFileName ? getMimeType(urlFileName) : null;
  const isVideo = mimeType?.startsWith('video/');
  const isImage = mimeType?.startsWith('image/');
  const isHtml = mimeType === 'text/html';
  const canEdit = !viewedNpub || viewedNpub === userNpub || !isLoggedIn;

  // Check if currently viewed file was recently changed
  const recentlyChangedFiles = useRecentlyChanged();
  const isWebm = mimeType === 'video/webm';
  const isRecentlyChanged = urlFileName && !isEditing && recentlyChangedFiles.has(urlFileName);

  // Stable key for video - only changes when file path changes, not on hash updates
  const videoKeyRef = useRef<string | null>(null);
  const currentFilePath = urlFileName ? `${currentPath.join('/')}/${urlFileName}` : null;
  if (currentFilePath !== videoKeyRef.current) {
    videoKeyRef.current = currentFilePath;
  }

  // Load file content when entry is found (skip for video - it streams)
  useEffect(() => {
    // Reset edit content when file changes
    setEditContent('');

    // Clear content immediately when selection changes
    setContent(null);
    setFileHash(null);
    setLoading(false);

    if (!entry || isVideo) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFileHash(entry.hash);

    // Pass decryption key for encrypted files
    getTree().readFile(entry.hash, entry.key).then(data => {
      if (!cancelled) {
        setContent(data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [entry?.hash, isVideo]);

  // Initialize editContent when entering edit mode
  useEffect(() => {
    if (isEditing && content) {
      const text = decodeAsText(content);
      if (text !== null) {
        setEditContent(text);
      }
    }
  }, [isEditing, content]);

  // Silent save for autosave - doesn't update content state to avoid re-render
  const silentSave = useCallback(async () => {
    if (isEditing && entry?.name) {
      await saveFile(entry.name, editContent);
    }
  }, [entry?.name, isEditing, editContent]);

  // Debounced autosave (1 second after typing stops)
  const debouncedSave = useDebounce(silentSave, 1000);

  const isText = content ? decodeAsText(content) !== null : false;

  const handleEdit = () => {
    if (!content) return;
    if (decodeAsText(content) !== null) {
      setIsEditing(true);
    }
  };

  const handleDownload = async () => {
    if (!entry) return;

    let data = content;
    // For video files, content isn't preloaded - fetch it now
    if (!data && isVideo) {
      data = await getTree().readFile(entry.hash, entry.key);
    }
    if (!data) return;

    const blob = new Blob([new Uint8Array(data)], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    const newData = await saveFile(entry?.name, editContent);
    if (newData) setContent(newData);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
    if (autoSave) {
      debouncedSave();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header - only show when file selected and not fullscreen */}
      {(entry || urlFileName) && !isFullscreen && (
        <div className="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center justify-between bg-surface-1">
          <span className="font-medium flex items-center gap-2">
            {(entry || urlFileName) && (
            <button
              onClick={() => {
                // Navigate to directory (remove file from URL)
                const parts: string[] = [];
                if (viewedNpub && currentTreeName) {
                  parts.push(viewedNpub, currentTreeName, ...currentPath);
                }
                navigate('/' + parts.map(encodeURIComponent).join('/'));
              }}
              className="bg-transparent border-none text-text-1 cursor-pointer p-1 lg:hidden"
            >
              <span className="i-lucide-chevron-left text-lg" />
            </button>
          )}
          {/* Show avatar (for npub routes) or hash icon (for nhash routes) */}
          {viewedNpub ? (
            <Link to={`/${viewedNpub}/profile`} className="shrink-0">
              <Avatar pubkey={npubToPubkey(viewedNpub) || viewedNpub} size={20} />
            </Link>
          ) : route.isPermalink && (
            <span className="i-lucide-hash text-accent shrink-0" />
          )}
          {/* Encryption status icon */}
          <span
            className={`${rootKey ? 'i-lucide-lock' : 'i-lucide-globe'} text-text-2 shrink-0`}
            title={rootKey ? 'Encrypted' : 'Public'}
          />
          {/* File type icon */}
          <span className={`${getFileIcon(entry?.name || urlFileName || '')} text-text-2 shrink-0`} />
          {entry?.name || urlFileName || ''}
          {isRecentlyChanged && (
            <span className="ml-2 px-1.5 py-0.5 text-xs font-bold bg-red-600 text-white rounded animate-pulse">
              LIVE
            </span>
          )}
        </span>

        {entry && !isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="btn-ghost"
              title="Download file"
              disabled={loading && !isVideo}
            >
              Download
            </button>
            {/* Permalink to this specific file's hash */}
            <Link
              to={`/${nhashEncode(toHex(entry.hash))}/${encodeURIComponent(entry.name)}`}
              className="btn-ghost no-underline"
              title={toHex(entry.hash)}
            >
              Permalink
            </Link>
            <button
              onClick={() => setIsFullscreen(true)}
              className="btn-ghost"
              title="Fullscreen"
            >
              <span className="i-lucide-maximize text-base" />
            </button>
            {canEdit && (
              <>
                <button onClick={() => openRenameModal(entry?.name)} className="btn-ghost">Rename</button>
                {isLikelyTextFile(entry.name) && (
                  <button
                    onClick={handleEdit}
                    className="btn-ghost"
                    disabled={loading || !content || !isText}
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Delete ${entry.name}?`)) {
                      deleteEntry(entry.name);
                      // Navigate back to directory
                      const parts: string[] = [];
                      if (viewedNpub && currentTreeName) {
                        parts.push(viewedNpub, currentTreeName, ...currentPath);
                      }
                      navigate('/' + parts.map(encodeURIComponent).join('/'));
                    }
                  }}
                  className="btn-ghost text-danger"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {isEditing && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => { setAutoSave(e.target.checked); }}
                className="cursor-pointer"
              />
              Auto
            </label>
            <button onClick={handleSave} className="btn-success">
              Save
            </button>
            <button onClick={() => { setIsEditing(false); }} className="btn-ghost">
              Done
            </button>
          </div>
        )}
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-auto ${isVideo || isImage || isHtml ? '' : 'p-4'}`}>
        {/* Show textarea immediately if in edit mode with a filename (even before entry loads) */}
        {isEditing && urlFileName ? (
          <textarea
            value={editContent}
            onChange={handleInput}
            autoFocus={editContent === ''}
            className="w-full h-full min-h-300px input font-mono text-sm resize-y"
          />
        ) : !entry ? (
          <DirectoryActions />
        ) : loading ? (
          showLoading ? <div className="w-full h-full flex items-center justify-center text-muted">Loading...</div> : null
        ) : isVideo && mimeType ? (
          viewedNpub && currentTreeName ? (
            // Use resolver subscription for live updates
            <LiveVideo
              key={videoKeyRef.current}
              resolverKey={getResolverKey(viewedNpub, currentTreeName)}
              filePath={[...currentPath, entry.name]}
              mimeType={mimeType}
              initialHash={useAppStore.getState().rootHash ?? undefined}
            />
          ) : (
            // Direct hash access (no resolver)
            <LiveVideoFromHash hash={entry.hash} mimeType={mimeType} />
          )
        ) : content ? (
          <ContentView data={content} filename={entry.name} onDownload={handleDownload} />
        ) : null}
      </div>
    </div>
  );
}

function ContentView({ data, filename, onDownload }: { data: Uint8Array; filename?: string; onDownload?: () => void }) {
  const text = decodeAsText(data);
  const mimeType = getMimeType(filename);
  const blobUrl = useMemo(() => {
    if (mimeType && isInlineViewable(mimeType)) {
      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      return URL.createObjectURL(blob);
    }
    return null;
  }, [data, mimeType]);

  // HTML files - render in sandboxed iframe
  const isHtml = filename?.toLowerCase().endsWith('.html') || filename?.toLowerCase().endsWith('.htm');
  const htmlBlobUrl = useMemo(() => {
    if (text !== null && isHtml) {
      const blob = new Blob([text], { type: 'text/html' });
      return URL.createObjectURL(blob);
    }
    return null;
  }, [text, isHtml]);

  if (htmlBlobUrl) {
    return (
      <iframe
        src={htmlBlobUrl}
        className="block w-full h-full border-none bg-surface-0"
        title={filename}
        sandbox="allow-scripts"
      />
    );
  }

  // Markdown files
  const isMarkdown = filename?.toLowerCase().endsWith('.md');
  if (text !== null && isMarkdown) {
    return (
      <div className="prose prose-sm max-w-none text-text-1">
        <Markdown>{text}</Markdown>
      </div>
    );
  }

  // Text content
  if (text !== null) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-all text-sm font-mono">
        {text}
      </pre>
    );
  }

  // Inline viewable content
  if (blobUrl && mimeType) {
    if (mimeType.startsWith('image/')) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <img
            src={blobUrl}
            alt={filename}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      );
    }

    if (mimeType === 'application/pdf') {
      return (
        <iframe
          src={blobUrl}
          className="w-full h-300px border-none"
          title={filename}
        />
      );
    }

    // Note: video is handled by LiveVideo in Preview component

    if (mimeType.startsWith('audio/')) {
      return (
        <audio src={blobUrl} controls className="w-full" />
      );
    }
  }

  // Binary/unsupported format fallback - show download pane (matches upload zone size)
  return (
    <div className="w-full h-full p-3">
      <div
        className="w-full h-full flex flex-col items-center justify-center text-accent cursor-pointer hover:bg-accent/10 transition-colors border border-accent/50 rounded-lg"
        onClick={onDownload}
      >
        <span className="i-lucide-download text-4xl mb-2" />
        <span className="text-sm mb-1">{filename || 'Download file'}</span>
        <span className="text-xs text-text-2">{formatBytes(data.length)}</span>
      </div>
    </div>
  );
}

function getMimeType(filename?: string): string | null {
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

function isInlineViewable(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf'
  );
}

// Get icon class based on file extension
function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg': case 'ico': case 'bmp':
      return 'i-lucide-image';
    case 'mp4': case 'webm': case 'mkv': case 'avi': case 'mov':
      return 'i-lucide-video';
    case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a':
      return 'i-lucide-music';
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

function isLikelyTextFile(filename?: string): boolean {
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

function DirectoryActions() {
  const rootCid = useAppStore(s => s.rootCid);
  const rootHash = rootCid?.hash ?? null;
  const currentDirCid = useCurrentDirCid();
  const currentDirHash = currentDirCid?.hash ?? null;
  const { entries } = useDirectoryEntries(currentDirCid);
  const route = useRoute();
  const viewedNpub = route.npub;
  const userNpub = useNostrStore(s => s.npub);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);
  const { uploadProgress, uploadFiles, cancelUpload } = useUpload();

  const canEdit = !viewedNpub || viewedNpub === userNpub || !isLoggedIn;
  // Show actions if we have a tree OR we're in a tree context (empty tree that hasn't been created yet)
  const hasTreeContext = rootHash !== null || (route.treeName !== null && canEdit);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dirHash = currentDirHash ? toHex(currentDirHash) : null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Handle external file drop
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleFileDragOver = (e: React.DragEvent) => {
    if (!canEdit) return;
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingOver(true);
    }
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      setIsDraggingOver(false);
    }
  };

  // Find and load README.md
  useEffect(() => {
    setReadmeContent(null);
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && !e.isTree
    );
    if (!readmeEntry) return;

    let cancelled = false;
    // Pass decryption key for encrypted files
    getTree().readFile(readmeEntry.hash, readmeEntry.key).then(data => {
      if (!cancelled && data) {
        const text = decodeAsText(data);
        if (text) setReadmeContent(text);
      }
    });
    return () => { cancelled = true; };
  }, [entries]);

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* Action buttons */}
      {hasTreeContext && (
        <div className="p-3 shrink-0">
          <FolderActions dirHash={dirHash} canEdit={canEdit} />
        </div>
      )}

      {/* Upload drop zone */}
      {hasTreeContext && canEdit && !readmeContent && (
        <div
          className={`flex-1 mx-3 mb-3 flex items-center justify-center cursor-pointer transition-colors border border-surface-3 rounded-lg ${isDraggingOver ? 'bg-surface-1/50' : 'hover:bg-surface-1/50'}`}
          onClick={uploadProgress ? undefined : openFilePicker}
        >
          {uploadProgress ? (
            <div className="flex flex-col items-center text-text-2 w-64">
              <span className="i-lucide-loader-2 text-4xl mb-3 animate-spin text-accent" />
              <span className="text-sm mb-2 truncate max-w-full">{uploadProgress.fileName}</span>
              <div className="w-full h-2 bg-surface-2 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                />
              </div>
              <span className="text-xs mt-1 text-text-3">
                {uploadProgress.current} / {uploadProgress.total}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cancelUpload();
                }}
                className="mt-3 btn-ghost text-xs px-3 py-1 text-danger hover:bg-danger/10"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center text-text-3">
              <span className="i-lucide-plus text-4xl mb-2" />
              <span className="text-sm">Drop or click to add</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>
      )}

      {/* README.md content */}
      {readmeContent && (
        <div className="flex-1 overflow-auto px-4 pb-4 lg:px-8 lg:pb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-text-2 text-sm font-medium">README.md</span>
            {canEdit && (
              <button
                onClick={() => {
                  const readmeEntry = entries.find(
                    e => e.name.toLowerCase() === 'readme.md' && !e.isTree
                  );
                  if (readmeEntry) {
                    selectFile(readmeEntry);
                  }
                }}
                className="btn-ghost text-xs px-2 py-1"
              >
                Edit
              </button>
            )}
          </div>
          <div className="prose prose-sm max-w-none text-text-1">
            <Markdown>{readmeContent}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

