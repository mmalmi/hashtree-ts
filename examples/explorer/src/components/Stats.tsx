import { toHex } from 'hashtree';
import { useAppStore, formatBytes } from '../store';
import { useStats } from '../hooks';

export function Stats() {
  const stats = useStats();
  const rootHashVal = useAppStore(s => s.rootHash);

  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-muted">
        {stats.items} items
      </span>
      <span className="text-muted">
        {formatBytes(stats.bytes)}
      </span>
      {rootHashVal && (
        <code className="text-xs text-text-3 font-mono">
          {toHex(rootHashVal).slice(0, 12)}...
        </code>
      )}
    </div>
  );
}
