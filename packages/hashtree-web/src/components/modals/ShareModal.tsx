/**
 * ShareModal - unified sharing options with QR code, copy link, and native share
 */
import { useState, useEffect } from 'react';
import { useModals, closeShareModal } from '../../hooks/useModals';

export function ShareModal() {
  const { showShareModal, shareUrl } = useModals();
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Generate QR code when modal opens
  useEffect(() => {
    if (!showShareModal || !shareUrl) {
      setQrDataUrl(null);
      return;
    }

    // Simple QR code generation using a canvas
    generateQrCode(shareUrl).then(setQrDataUrl);
  }, [showShareModal, shareUrl]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showShareModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeShareModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showShareModal]);

  if (!showShareModal || !shareUrl) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ url: shareUrl });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Share failed:', e);
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex-center z-1000"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeShareModal();
      }}
    >
      <div className="bg-surface-1 rounded-lg p-6 min-w-300px max-w-400px border border-surface-3">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Share</h3>
          <button
            onClick={closeShareModal}
            className="text-text-3 hover:text-text-1 transition-colors"
          >
            <span className="i-lucide-x text-xl" />
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded bg-white p-2" />
          ) : (
            <div className="w-48 h-48 rounded bg-surface-2 flex-center">
              <span className="i-lucide-loader-2 animate-spin text-2xl text-text-3" />
            </div>
          )}
        </div>

        {/* URL display */}
        <div className="bg-surface-2 rounded p-2 mb-4 text-sm text-text-2 break-all font-mono">
          {shareUrl}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCopyLink}
            className="btn-ghost w-full flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <span className="i-lucide-check text-success" />
                Copied!
              </>
            ) : (
              <>
                <span className="i-lucide-copy" />
                Copy Link
              </>
            )}
          </button>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={handleNativeShare}
              className="btn-ghost w-full flex items-center justify-center gap-2"
            >
              <span className="i-lucide-share" />
              Share via...
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Generate a QR code as a data URL using canvas
 * Uses a simple QR code library approach with error correction
 */
async function generateQrCode(text: string): Promise<string> {
  // Use a CDN-loaded QR code library for simplicity
  // We'll use the qrcode npm package pattern but generate manually

  const size = 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  try {
    // Try to use the QRCode library if available (loaded dynamically)
    const QRCode = (window as unknown as { QRCode?: { toCanvas: (canvas: HTMLCanvasElement, text: string, options: object) => Promise<void> } }).QRCode;
    if (QRCode) {
      await QRCode.toCanvas(canvas, text, {
        width: size,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      return canvas.toDataURL('image/png');
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: Use Google Charts API for QR code
  // This is a simple fallback that doesn't require any library
  const googleChartsUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(text)}&choe=UTF-8`;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      // If Google Charts fails, just show a placeholder
      ctx.fillStyle = '#666666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('QR unavailable', size / 2, size / 2);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = googleChartsUrl;
  });
}
