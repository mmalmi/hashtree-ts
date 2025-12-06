/**
 * ShareModal - unified sharing options with QR code, copy link, and native share
 */
import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useModals, closeShareModal } from '../../hooks/useModals';
import { CopyText } from '../CopyText';

export function ShareModal() {
  const { showShareModal, shareUrl } = useModals();
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
        (document.activeElement as HTMLElement)?.blur();
        closeShareModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showShareModal]);

  if (!showShareModal || !shareUrl) return null;

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
      <div className="bg-surface-1 sm:rounded-lg overflow-hidden w-screen sm:w-80 sm:max-w-sm sm:border border-surface-3">
        {/* QR Code - click to close */}
        <div className="cursor-pointer" onClick={closeShareModal}>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className="w-full bg-white" />
          ) : (
            <div className="w-full aspect-square bg-surface-2 flex-center">
              <span className="i-lucide-loader-2 animate-spin text-2xl text-text-3" />
            </div>
          )}
        </div>

        {/* URL with copy */}
        <div className="bg-surface-2 p-3 m-4 mb-2 rounded">
          <CopyText text={shareUrl} truncate={80} className="text-sm" />
        </div>

        {/* Native share button */}
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <div className="px-4 pb-4 pt-2">
            <button
              onClick={handleNativeShare}
              className="btn-ghost w-full flex items-center justify-center gap-2"
            >
              <span className="i-lucide-share" />
              Share via...
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Generate a QR code as a data URL */
async function generateQrCode(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
}
