/**
 * Hook to get store stats (items count, total bytes)
 * Reads directly from idbStore, no app state needed
 */
import { useState, useEffect } from 'react';
import { idbStore } from '../store';

interface Stats {
  items: number;
  bytes: number;
}

export function useStats(): Stats {
  const [stats, setStats] = useState<Stats>({ items: 0, bytes: 0 });

  useEffect(() => {
    let mounted = true;

    async function loadStats() {
      const items = await idbStore.count();
      const bytes = await idbStore.totalBytes();
      if (mounted) {
        setStats({ items, bytes });
      }
    }

    loadStats();

    // Poll for updates (store changes aren't observable)
    const interval = setInterval(loadStats, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return stats;
}
