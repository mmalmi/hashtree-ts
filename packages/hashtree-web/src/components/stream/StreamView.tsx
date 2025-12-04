/**
 * Inline stream view - renders in preview area instead of modal
 */
import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatBytes } from '../../store';
import { useNostrStore } from '../../nostr';
import { useRoute, useCurrentDirCid, useDirectoryEntries } from '../../hooks';
import {
  startPreview,
  stopPreview,
  startRecording,
  stopRecording,
  formatTime,
  useStreamState,
  setStreamFilename,
  setPersistStream,
} from './useStream';

export function StreamView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const route = useRoute();
  const { isRecording, recordingTime, streamStats } = useStreamState();

  // Navigate back to tree root
  const treeUrl = route.npub && route.treeName
    ? `/${route.npub}/${route.treeName}`
    : '/';

  useEffect(() => {
    return () => {
      stopPreview(videoRef.current);
      stopRecording();
    };
  }, []);

  const handleClose = () => {
    if (!isRecording) {
      stopPreview(videoRef.current);
      navigate(treeUrl);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header */}
      <div className="h-10 shrink-0 px-3 border-b border-surface-3 flex items-center justify-between bg-surface-1">
        <span className="font-medium flex items-center gap-2">
          <span className="i-lucide-video text-accent" />
          Livestream
          {isRecording && (
            <span className="inline-flex items-center gap-1.5 text-danger text-sm">
              <span className="w-2 h-2 bg-danger rounded-full animate-pulse" />
              REC {formatTime(recordingTime)}
            </span>
          )}
        </span>
        {!isRecording && (
          <button onClick={handleClose} className="btn-ghost">
            <span className="i-lucide-x" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full aspect-video bg-surface-2 rounded"
        />

        {isRecording && (
          <div className="flex items-center gap-4 text-sm text-muted">
            <span>{formatBytes(streamStats.totalSize)}</span>
          </div>
        )}

        <StreamControls videoRef={videoRef} onCancel={handleClose} />
        <ShareLink />
      </div>
    </div>
  );
}

function StreamControls({ videoRef, onCancel }: { videoRef: { current: HTMLVideoElement | null }; onCancel: () => void }) {
  const { isRecording, isPreviewing, streamFilename, persistStream } = useStreamState();
  const currentDirCid = useCurrentDirCid();
  const { entries } = useDirectoryEntries(currentDirCid);

  const filenameExists = entries.some(e => e.name === `${streamFilename}.webm`);

  if (!isPreviewing && !isRecording) {
    return (
      <button
        onClick={() => startPreview(videoRef.current)}
        className="p-3 btn-primary"
      >
        Start Camera
      </button>
    );
  }

  if (isRecording) {
    return (
      <button onClick={stopRecording} className="p-3 btn-success">
        <span className="i-lucide-square mr-2" />
        Stop Recording
      </button>
    );
  }

  // Preview mode - show filename input and controls
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 items-center">
        <div className="flex items-center flex-1">
          <input
            type="text"
            value={streamFilename}
            onChange={(e) => {
              setStreamFilename(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''));
            }}
            placeholder="filename"
            className="flex-1 p-3 bg-surface-0 border border-surface-3 rounded-l text-text-1"
          />
          <span className="p-3 bg-surface-2 border border-surface-3 border-l-0 rounded-r text-muted">
            .webm
          </span>
        </div>
      </div>

      {filenameExists && (
        <div className="text-danger text-sm">
          Overwrites existing {streamFilename}.webm
        </div>
      )}

      {/* Storage mode toggle */}
      <div className="flex gap-2 text-sm">
        <button
          onClick={() => { setPersistStream(true); }}
          className={`flex-1 p-2 rounded-sm cursor-pointer ${
            persistStream
              ? 'bg-success text-white border-none'
              : 'bg-surface-2 text-muted border border-surface-3'
          }`}
        >
          Full Recording
        </button>
        <button
          onClick={() => { setPersistStream(false); }}
          className={`flex-1 p-2 rounded-sm cursor-pointer ${
            !persistStream
              ? 'bg-accent text-white border-none'
              : 'bg-surface-2 text-muted border border-surface-3'
          }`}
        >
          Live Only (30s)
        </button>
      </div>
      <div className="text-muted text-xs">
        {persistStream
          ? 'Saves entire stream to file'
          : 'Keeps only last 30 seconds (for live viewing)'}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => startRecording(videoRef.current)}
          className="flex-1 p-3 btn-danger"
        >
          <span className="i-lucide-circle mr-2" />
          Start Recording
        </button>
        <button
          onClick={() => {
            stopPreview(videoRef.current);
            onCancel();
          }}
          className="p-3 btn-ghost"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ShareLink() {
  const { isRecording, streamFilename } = useStreamState();
  const selectedTree = useNostrStore(s => s.selectedTree);
  const route = useRoute();

  if (!isRecording) return null;

  if (selectedTree && route.npub && route.treeName) {
    const filename = `${streamFilename}.webm`;
    // Build URL from route path, excluding /stream suffix (which is the stream view route, not a directory)
    const basePath = `${route.npub}/${route.treeName}`;
    const pathWithoutStream = route.path.filter(p => p !== 'stream');
    const dirPath = pathWithoutStream.length > 0 ? `/${pathWithoutStream.join('/')}` : '';
    const shareUrl = `${window.location.origin}/#/${basePath}${dirPath}/${encodeURIComponent(filename)}`;
    return (
      <div className="p-3 bg-surface-1 rounded text-sm">
        <div className="text-muted mb-1">Share link:</div>
        <a href={shareUrl} target="_blank" className="text-accent break-all">
          {shareUrl}
        </a>
      </div>
    );
  }

  return (
    <div className="p-3 bg-red-900/30 rounded text-sm text-danger">
      Select a hashtree to enable live sharing
    </div>
  );
}
