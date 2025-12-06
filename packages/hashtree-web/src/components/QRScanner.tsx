/**
 * QR Scanner component for scanning npubs from QR codes
 * Based on iris-client implementation
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QRScannerProps {
  onScanSuccess: (result: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScanSuccess, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Check for camera support
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access not supported in this browser');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment' }, // Use back camera if available
      })
      .then((stream) => {
        streamRef.current = stream;
        video.srcObject = stream;
        video.play();

        const scanQRCode = () => {
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            // Set canvas dimensions to match video
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;

            // Draw current video frame to canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Get image data for QR processing
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Process with jsQR
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert', // Faster processing
            });

            if (code) {
              // QR code found - extract npub from scanned text
              const text = code.data;
              onScanSuccess(text);
              return; // Stop scanning after success
            }
          }

          // Continue scanning
          animationRef.current = requestAnimationFrame(scanQRCode);
        };

        scanQRCode();
      })
      .catch((err) => {
        console.error('Error accessing camera:', err);
        setError('Unable to access camera. Please make sure you have granted camera permissions.');
      });

    // Cleanup function
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="fixed inset-0 bg-black/90 flex-center z-1010">
      <div className="relative w-full max-w-md mx-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-accent"
          aria-label="Close scanner"
        >
          <span className="i-lucide-x text-2xl" />
        </button>

        {/* Scanner viewport */}
        <div className="bg-surface-1 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-surface-3">
            <h3 className="text-lg font-semibold">Scan QR Code</h3>
            <p className="text-sm text-muted">Point camera at a QR code containing an npub</p>
          </div>

          <div className="relative aspect-square">
            {error ? (
              <div className="flex-center h-full p-4">
                <p className="text-danger text-center">{error}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Scan overlay with corner markers */}
                <div className="absolute inset-0 flex-center pointer-events-none">
                  <div className="w-2/3 h-2/3 relative">
                    {/* Corner markers */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-accent" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-accent" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-accent" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-accent" />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="p-3 border-t border-surface-3">
            <button onClick={onClose} className="btn-ghost w-full">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
