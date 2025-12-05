/**
 * ContentView - renders file content based on type
 */
import { useMemo } from 'react';
import Markdown from 'markdown-to-jsx';
import { formatBytes, decodeAsText } from '../../store';
import { ZipPreview } from '../ZipPreview';
import { getMimeType, isInlineViewable } from './utils';

interface ContentViewProps {
  data: Uint8Array;
  filename?: string;
  onDownload?: () => void;
}

export function ContentView({ data, filename, onDownload }: ContentViewProps) {
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

    // Note: video is handled by LiveVideo in Viewer component

    if (mimeType.startsWith('audio/')) {
      return (
        <audio src={blobUrl} controls className="w-full" />
      );
    }
  }

  // ZIP files - show preview with extraction option
  const isZip = filename?.toLowerCase().endsWith('.zip');
  if (isZip) {
    return <ZipPreview data={data} filename={filename || 'archive.zip'} onDownload={onDownload} />;
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
