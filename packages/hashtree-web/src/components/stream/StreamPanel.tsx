import { useRef, useEffect } from 'react';
import { formatBytes } from '../../store';
import { useNostrStore } from '../../nostr';
import { useCurrentDirCid, useDirectoryEntries } from '../../hooks';
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

export function StreamPanel({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isRecording } = useStreamState();

  useEffect(() => {
    return () => {
      stopPreview(videoRef.current);
      stopRecording();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex-center z-100"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRecording) onClose();
      }}
    >
      <div className="bg-surface-1 rounded-lg p-6 w-90% max-w-640px">
        <StreamHeader onClose={onClose} />

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full aspect-video bg-surface-0 rounded mb-4"
        />

        <StreamStatus />
        <StreamControls videoRef={videoRef} onClose={onClose} />
        <ShareLink />
      </div>
    </div>
  );
}

function StreamHeader({ onClose }: { onClose: () => void }) {
  const { isRecording } = useStreamState();

  return (
    <div className="flex-between mb-4">
      <h3 className="m-0">Livestream</h3>
      {!isRecording && (
        <button
          onClick={onClose}
          className="bg-transparent border-none text-muted cursor-pointer p-1"
        >
          <span className="i-lucide-x text-lg" />
        </button>
      )}
    </div>
  );
}

function StreamStatus() {
  const { isRecording, recordingTime, streamStats } = useStreamState();

  if (!isRecording) return null;

  return (
    <div className="flex gap-4 items-center mb-4">
      <span className="inline-flex items-center gap-2 text-danger">
        <span className="w-2.5 h-2.5 bg-danger rounded-full animate-pulse" />
        REC {formatTime(recordingTime)}
      </span>
      <span className="text-muted">
        {formatBytes(streamStats.totalSize)}
      </span>
    </div>
  );
}

function StreamControls({ videoRef, onClose }: {
  videoRef: { current: HTMLVideoElement | null };
  onClose: () => void;
}) {
  const { isRecording, isPreviewing } = useStreamState();

  return (
    <div className="flex gap-2">
      {!isPreviewing && !isRecording && (
        <button
          onClick={() => startPreview(videoRef.current)}
          className="flex-1 p-3 btn-primary"
        >
          Start Camera
        </button>
      )}

      {isPreviewing && !isRecording && (
        <PreviewControls videoRef={videoRef} onClose={onClose} />
      )}

      {isRecording && (
        <button onClick={stopRecording} className="flex-1 p-3 btn-success">
          ■ Stop
        </button>
      )}
    </div>
  );
}

function PreviewControls({ videoRef, onClose }: {
  videoRef: { current: HTMLVideoElement | null };
  onClose: () => void;
}) {
  const currentDirCid = useCurrentDirCid();
  const { entries } = useDirectoryEntries(currentDirCid);
  const { streamFilename, persistStream } = useStreamState();

  const filenameExists = entries.some(e => e.name === `${streamFilename}.webm`);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 items-center">
        <div className="flex items-center gap-1 flex-1">
          <input
            type="text"
            value={streamFilename}
            onInput={(e) => {
              setStreamFilename((e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_-]/g, ''));
            }}
            placeholder="filename"
            className="flex-1 p-3 bg-surface-0 border border-surface-3 rounded-l text-text-1"
          />
          <span className="p-3 bg-surface-2 border border-surface-3 border-l-0 rounded-r text-muted">
            .webm
          </span>
        </div>
        <button
          onClick={() => startRecording(videoRef.current)}
          className="p-3 btn-danger"
        >
          ● Stream
        </button>
        <button
          onClick={() => { stopPreview(videoRef.current); onClose(); }}
          className="p-3 btn-ghost"
        >
          Cancel
        </button>
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
    </div>
  );
}

function ShareLink() {
  const { isRecording } = useStreamState();
  const selectedTreeVal = useNostrStore(s => s.selectedTree);

  if (!isRecording) return null;

  if (selectedTreeVal) {
    return (
      <div className="mt-4 p-3 bg-surface-0 rounded text-sm">
        <div className="text-muted mb-1">Share link:</div>
        <a href={window.location.href} target="_blank" className="text-accent break-all">
          {window.location.href}
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 p-3 bg-red-900/30 rounded text-sm text-danger">
      Select a hashtree to enable live sharing
    </div>
  );
}
