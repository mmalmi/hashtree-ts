import { useState, useEffect } from 'react';

/**
 * Hook that returns true only after a delay has passed.
 * Useful for showing loading indicators only for slow loads.
 *
 * @param isLoading - Whether the loading state is active
 * @param delayMs - How long to wait before showing loading (default 2000ms)
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 2000): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowLoading(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  return showLoading;
}
