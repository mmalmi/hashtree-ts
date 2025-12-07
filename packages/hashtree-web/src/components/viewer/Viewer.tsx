/**
 * Viewer - main file viewer component
 */
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { toHex, nhashEncode } from 'hashtree';
import type { CID } from 'hashtree';
import { Avatar } from '../user';
import { npubToPubkey } from '../../nostr';
import { LiveVideo, LiveVideoFromHash } from '../LiveVideo';
import { DosBoxViewer, isDosExecutable } from '../DosBox';
import { HtmlViewer } from '../HtmlViewer';
import { decodeAsText, getTree } from '../../store';
import { saveFile, deleteEntry } from '../../actions';
import { openRenameModal, openShareModal, openUnsavedChangesModal } from '../../hooks/useModals';
import { useNostrStore } from '../../nostr';
import { useSettingsStore } from '../../stores/settings';
import { useRoute, useCurrentDirCid, useDirectoryEntries, useTreeRoot, useTrees, usePathType } from '../../hooks';
import { VisibilityIcon, LinkLockIcon } from '../VisibilityIcon';
import { getResolverKey } from '../../refResolver';
import { useRecentlyChanged } from '../../hooks/useRecentlyChanged';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { ContentView } from './ContentView';
import { DirectoryActions } from './DirectoryActions';
import { getMimeType, getFileIcon, isLikelyTextFile, useDebounce } from './utils';
import { NavButton } from '../NavButton';

/** Save button with stable width */
function SaveButton({ saved, onClick }: { saved: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-success relative">
      <span className="invisible flex items-center gap-1">
        <span className="i-lucide-check" />
        Saved
      </span>
      <span className="absolute inset-0 flex items-center justify-center gap-1">
        {saved ? <><span className="i-lucide-check" />Saved</> : 'Save'}
      </span>
    </button>
  );
}

export function Viewer() {
  const navigate = useNavigate();
  const location = useLocation();
  const rootCid = useTreeRoot();
  const currentDirCid = useCurrentDirCid();
  const { entries } = useDirectoryEntries(currentDirCid);

  const route = useRoute();
  const viewedNpub = route.npub;
  const currentTreeName = route.treeName;
  const userNpub = useNostrStore(s => s.npub);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);

  // Get current tree for visibility info
  const targetNpub = viewedNpub || userNpub;
  const trees = useTrees(targetNpub);
  const currentTree = currentTreeName ? trees.find(t => t.name === currentTreeName) : null;

  // Get filename from URL path - uses hashtree to determine if last segment is file or directory
  const { dirPath, fileName: urlFileName } = usePathType();
  const currentPath = dirPath;

  // Find entry in current entries list (for metadata like hash)
  const entryFromStore = useMemo(() => {
    if (!urlFileName) return null;
    return entries.find(e => e.name === urlFileName && !e.isTree) || null;
  }, [urlFileName, entries]);

  // Get files only (no directories) for prev/next navigation
  const filesOnly = useMemo(() => entries.filter(e => !e.isTree), [entries]);
  const currentFileIndex = useMemo(() => {
    if (!urlFileName) return -1;
    return filesOnly.findIndex(e => e.name === urlFileName);
  }, [filesOnly, urlFileName]);
  // Wrap around at start/end
  const prevFile = filesOnly.length > 1 && currentFileIndex >= 0
    ? filesOnly[(currentFileIndex - 1 + filesOnly.length) % filesOnly.length]
    : null;
  const nextFile = filesOnly.length > 1 && currentFileIndex >= 0
    ? filesOnly[(currentFileIndex + 1) % filesOnly.length]
    : null;

  // Navigate to a file in the same directory
  const navigateToFile = useCallback((fileName: string) => {
    const parts: string[] = [];
    if (viewedNpub && currentTreeName) {
      parts.push(viewedNpub, currentTreeName, ...currentPath, fileName);
    }
    navigate('/' + parts.map(encodeURIComponent).join('/') + location.search);
  }, [viewedNpub, currentTreeName, currentPath, navigate, location.search]);

  // File state - content loaded from cid
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0-100
  const showLoading = useDelayedLoading(loading);
  const [, setFileCid] = useState<CID | null>(null);
  const [resolvedEntry, setResolvedEntry] = useState<{ name: string; cid: CID; size?: number } | null>(null);

  // Use store entry if available, otherwise use resolved entry
  const entry = entryFromStore || resolvedEntry;

  // Resolve file cid from path when store entry is not available
  useEffect(() => {
    if (entryFromStore) {
      setResolvedEntry(null);
      return;
    }

    // For permalinks without path, check if rootCid itself is a file
    if (route.isPermalink && !urlFileName && rootCid?.hash) {
      let cancelled = false;
      const tree = getTree();
      tree.isDirectory(rootCid).then(isDir => {
        if (!cancelled && !isDir) {
          // The rootCid is the file itself
          setResolvedEntry({ name: 'file', cid: rootCid });
        }
      });
      return () => { cancelled = true; };
    }

    if (!urlFileName || !rootCid) {
      setResolvedEntry(null);
      return;
    }

    let cancelled = false;
    const tree = getTree();

    // For permalinks with path, check if rootCid itself is a file (not a directory)
    // In that case, the path is just the filename for display purposes
    if (route.isPermalink && rootCid?.hash) {
      tree.isDirectory(rootCid).then(isDir => {
        if (!cancelled && !isDir) {
          // The rootCid is the file itself, use urlFileName for display
          setResolvedEntry({ name: urlFileName, cid: rootCid });
        } else if (!cancelled && isDir) {
          // It's a directory, resolve the path within it
          const fullPath = [...currentPath, urlFileName].join('/');
          tree.resolvePath(rootCid, fullPath).then(async result => {
            if (!cancelled && result?.cid?.hash) {
              const isFileDir = await tree.isDirectory(result.cid);
              if (!cancelled && !isFileDir) {
                setResolvedEntry({ name: urlFileName, cid: result.cid });
              }
            }
          });
        }
      });
    } else if (!route.isPermalink) {
      // Non-permalink: resolve path normally
      const fullPath = [...currentPath, urlFileName].join('/');
      tree.resolvePath(rootCid, fullPath).then(async result => {
        if (!cancelled && result?.cid?.hash) {
          const isDir = await tree.isDirectory(result.cid);
          if (!cancelled && !isDir) {
            setResolvedEntry({ name: urlFileName, cid: result.cid });
          }
        }
      });
    }

    return () => { cancelled = true; };
  }, [entryFromStore, urlFileName, rootCid?.hash ? toHex(rootCid.hash) : null, currentPath.join('/'), route.isPermalink]);

  // Parse query params from location.search (works with hash routing)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // Edit mode is driven by URL query param
  const isEditing = searchParams.get('edit') === '1';
  const isFullscreen = searchParams.get('fullscreen') === '1';
  const [editContent, setEditContent] = useState('');
  const [savedContent, setSavedContent] = useState(''); // Content as of last save (for detecting unsaved changes)
  const autoSave = useSettingsStore((s) => s.editor.autoSave);
  const setAutoSave = useSettingsStore((s) => s.setEditorSettings);
  const [saved, setSaved] = useState(false);

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
  const isDosExe = urlFileName ? isDosExecutable(urlFileName) : false;
  const canEdit = !viewedNpub || viewedNpub === userNpub || !isLoggedIn;

  // Debug: log DOS exe detection
  if (isDosExe) {
    console.log('[Viewer] DOS exe detected:', urlFileName, { isDosExe, entry: !!entry, currentDirCid: !!currentDirCid });
  }

  // Check if currently viewed file was recently changed
  const recentlyChangedFiles = useRecentlyChanged();
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
    setFileCid(null);
    setLoading(false);
    setLoadProgress(0);

    if (!entry || isVideo || isDosExe) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFileCid(entry.cid);

    // Use streaming to track progress
    const totalSize = entry.size || 0;
    const chunks: Uint8Array[] = [];
    let bytesLoaded = 0;

    (async () => {
      try {
        for await (const chunk of getTree().readFileStream(entry.cid)) {
          if (cancelled) return;
          chunks.push(chunk);
          bytesLoaded += chunk.length;
          if (totalSize > 0) {
            setLoadProgress(Math.min(100, Math.round((bytesLoaded / totalSize) * 100)));
          }
        }
        if (!cancelled) {
          // Combine chunks
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          setContent(result);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [entry?.cid?.hash ? toHex(entry.cid.hash) : null, isVideo]);

  // Initialize editContent when entering edit mode
  useEffect(() => {
    if (isEditing && content) {
      const text = decodeAsText(content);
      if (text !== null) {
        setEditContent(text);
        setSavedContent(text); // Track original content for unsaved changes detection
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
      data = await getTree().readFile(entry.cid);
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
    if (newData) {
      setContent(newData);
      setSavedContent(editContent); // Update saved content tracker
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = isEditing && editContent !== savedContent;

  // Handle closing the editor - checks for unsaved changes
  const handleCloseEditor = useCallback(async () => {
    if (hasUnsavedChanges) {
      // If autosave is enabled, just save and close immediately
      if (autoSave) {
        await handleSave();
        setIsEditing(false);
      } else {
        // Show modal to ask user what to do
        openUnsavedChangesModal({
          fileName: entry?.name,
          onSave: async () => {
            await handleSave();
            setIsEditing(false);
          },
          onDiscard: () => {
            setIsEditing(false);
          },
        });
      }
    } else {
      setIsEditing(false);
    }
  }, [hasUnsavedChanges, autoSave, entry?.name, setIsEditing]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
    if (autoSave) {
      debouncedSave();
    }
  };

  const handleShare = useCallback(() => {
    // Strip ?edit=1 or &edit=1 from hash when sharing
    let url = window.location.href;
    url = url.replace(/[?&]edit=1/, '');
    openShareModal(url);
  }, []);

  // Keyboard navigation (when not editing)
  useEffect(() => {
    if (!entry && !urlFileName) return; // Only when viewing a file
    if (isEditing) return; // Don't navigate when editing

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with browser shortcuts (Cmd/Ctrl + arrows for back/forward)
      if (e.metaKey || e.ctrlKey) return;

      const key = e.key.toLowerCase();

      // Escape or h: back to directory
      if (key === 'escape' || key === 'h') {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        const parts: string[] = [];
        if (viewedNpub && currentTreeName) {
          parts.push(viewedNpub, currentTreeName, ...currentPath);
        }
        navigate('/' + parts.map(encodeURIComponent).join('/') + location.search);
        return;
      }

      // j/k/ArrowLeft/ArrowRight: prev/next file
      if ((key === 'j' || key === 'arrowright') && nextFile) {
        e.preventDefault();
        navigateToFile(nextFile.name);
        return;
      }
      if ((key === 'k' || key === 'arrowleft') && prevFile) {
        e.preventDefault();
        navigateToFile(prevFile.name);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [entry, urlFileName, isEditing, viewedNpub, currentTreeName, currentPath, navigate, location.search, prevFile, nextFile, navigateToFile]);

  // Escape key handler for edit mode
  useEffect(() => {
    if (!isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        handleCloseEditor();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, handleCloseEditor]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header - only show when file selected and not fullscreen */}
      {(entry || urlFileName) && !isFullscreen && (
        <div className="shrink-0 px-3 py-2 border-b border-surface-3 flex flex-wrap items-center gap-2 bg-surface-1">
          <span className="font-medium flex items-center gap-2 shrink-0">
            {(entry || urlFileName) && (
              <NavButton
                onClick={() => {
                  // Navigate to directory (remove file from URL), preserve query params like ?k=
                  const parts: string[] = [];
                  if (viewedNpub && currentTreeName) {
                    parts.push(viewedNpub, currentTreeName, ...currentPath);
                  }
                  navigate('/' + parts.map(encodeURIComponent).join('/') + location.search);
                }}
                className="lg:hidden"
              />
            )}
          {/* Show avatar (for npub routes) or hash icon (for nhash routes) */}
          {viewedNpub ? (
            <Link to={`/${viewedNpub}/profile`} className="shrink-0">
              <Avatar pubkey={npubToPubkey(viewedNpub) || viewedNpub} size={20} />
            </Link>
          ) : route.isPermalink && (
            rootCid?.key ? (
              <LinkLockIcon className="text-text-2" title="Encrypted permalink" />
            ) : (
              <span className="i-lucide-globe text-text-2 shrink-0" title="Public permalink" />
            )
          )}
          {/* Visibility icon */}
          {currentTree && (
            <VisibilityIcon visibility={currentTree.visibility} className="text-text-2" />
          )}
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
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              onClick={handleDownload}
              className="btn-ghost"
              title="Download file"
              disabled={loading && !isVideo}
            >
              Download
            </button>
            {/* Permalink to this specific file's hash (includes key if encrypted) */}
            {entry.cid?.hash && (
              <Link
                to={`/${nhashEncode({ hash: toHex(entry.cid.hash), decryptKey: entry.cid.key ? toHex(entry.cid.key) : undefined })}/${encodeURIComponent(entry.name)}`}
                className="btn-ghost no-underline"
                title={toHex(entry.cid.hash)}
              >
                Permalink
              </Link>
            )}
            <button
              onClick={() => setIsFullscreen(true)}
              className="btn-ghost"
              title="Fullscreen"
            >
              <span className="i-lucide-maximize text-base" />
            </button>
            <button
              onClick={handleShare}
              className="btn-ghost"
              title="Share"
            >
              <span className="i-lucide-share text-base" />
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
                      // Navigate back to directory, preserve query params like ?k=
                      const parts: string[] = [];
                      if (viewedNpub && currentTreeName) {
                        parts.push(viewedNpub, currentTreeName, ...currentPath);
                      }
                      navigate('/' + parts.map(encodeURIComponent).join('/') + location.search);
                    }
                  }}
                  className="btn-ghost text-danger"
                >
                  Delete
                </button>
              </>
            )}
            {/* Prev/Next file navigation - mobile only, wraps around */}
            {filesOnly.length > 1 && prevFile && nextFile && (
              <>
                <button
                  onClick={() => navigateToFile(prevFile.name)}
                  className="btn-ghost lg:hidden"
                  title={`Previous: ${prevFile.name}`}
                >
                  <span className="i-lucide-chevron-left text-base" />
                </button>
                <button
                  onClick={() => navigateToFile(nextFile.name)}
                  className="btn-ghost lg:hidden"
                  title={`Next: ${nextFile.name}`}
                >
                  <span className="i-lucide-chevron-right text-base" />
                </button>
              </>
            )}
          </div>
        )}

        {isEditing && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <label className="flex items-center gap-1 text-xs text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => { setAutoSave({ autoSave: e.target.checked }); }}
                className="cursor-pointer"
              />
              Autosave
            </label>
            <SaveButton saved={saved} onClick={handleSave} />
            <button onClick={handleCloseEditor} className="btn-ghost">
              Done
            </button>
            <button onClick={handleShare} className="btn-ghost" title="Share">
              <span className="i-lucide-share text-base" />
            </button>
          </div>
        )}
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 ${isEditing ? 'overflow-hidden p-4' : `overflow-auto ${isVideo || isImage || isHtml || isDosExe ? '' : 'p-4'}`}`}>
        {/* Show textarea immediately if in edit mode with a filename (even before entry loads) */}
        {isEditing && urlFileName ? (
          <textarea
            value={editContent}
            onChange={handleInput}
            autoFocus={editContent === ''}
            className="w-full h-full input font-mono text-sm resize-none"
          />
        ) : isVideo && mimeType && urlFileName ? (
          // Video: render immediately based on filename, don't wait for entry to load
          // This prevents remounting when merkle root changes during livestream
          viewedNpub && currentTreeName ? (
            // Use resolver subscription for live updates
            <LiveVideo
              key={videoKeyRef.current}
              resolverKey={getResolverKey(viewedNpub, currentTreeName)}
              filePath={[...currentPath, urlFileName]}
              mimeType={mimeType}
              initialCid={rootCid}
            />
          ) : entry ? (
            // Direct hash access (no resolver) - need entry for CID
            <LiveVideoFromHash cid={entry.cid} mimeType={mimeType} />
          ) : null
        ) : !entry ? (
          <DirectoryActions />
        ) : loading ? (
          showLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted gap-2">
              <div className="w-48 h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-150"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
              <span className="text-sm">{loadProgress}%</span>
            </div>
          ) : null
        ) : isDosExe && currentDirCid && entry?.cid?.hash ? (
          // DOS executable - show DOSBox viewer
          // Key on CID hash to prevent remounting when layout changes (fullscreen toggle)
          <DosBoxViewer
            key={toHex(entry.cid.hash)}
            exeCid={entry.cid}
            directoryCid={currentDirCid}
            exeName={entry.name}
          />
        ) : isHtml && content && currentDirCid && entry?.cid?.hash ? (
          // HTML file with directory context - can load sibling resources
          <HtmlViewer
            key={toHex(entry.cid.hash)}
            html={decodeAsText(content) || ''}
            directoryCid={currentDirCid}
            filename={entry.name}
          />
        ) : content ? (
          <ContentView data={content} filename={entry.name} onDownload={handleDownload} />
        ) : null}
      </div>
    </div>
  );
}
