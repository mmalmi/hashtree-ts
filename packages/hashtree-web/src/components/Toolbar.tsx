import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

export function Toolbar() {
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  const getCurrentUrl = useCallback(() => {
    // Build full URL including hash router path
    return window.location.href;
  }, []);

  const handleCopyLink = useCallback(async () => {
    const url = getCurrentUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }, [getCurrentUrl]);

  const handleShare = useCallback(async () => {
    const url = getCurrentUrl();

    // Use native share if available
    if (navigator.share) {
      try {
        await navigator.share({
          url,
        });
        return;
      } catch (e) {
        // User cancelled or share failed, fall back to copy
        if ((e as Error).name !== 'AbortError') {
          console.error('Share failed:', e);
        }
      }
    }

    // Fall back to copy
    handleCopyLink();
  }, [getCurrentUrl, handleCopyLink]);

  // Don't show share on home route
  const isHome = location.pathname === '/';
  if (isHome) {
    return <div className="flex-1" />;
  }

  return (
    <div className="flex-1 flex items-center justify-end gap-1">
      {/* Copy link button */}
      <button
        onClick={handleCopyLink}
        className="btn-ghost p-1.5 text-text-2 hover:text-text-1"
        title="Copy link"
      >
        {copied ? (
          <span className="i-lucide-check text-success" />
        ) : (
          <span className="i-lucide-link" />
        )}
      </button>

      {/* Share button (shows native share on supported platforms) */}
      {typeof navigator !== 'undefined' && navigator.share && (
        <button
          onClick={handleShare}
          className="btn-ghost p-1.5 text-text-2 hover:text-text-1"
          title="Share"
        >
          <span className="i-lucide-share" />
        </button>
      )}
    </div>
  );
}
