import { toHex } from 'hashtree';
import { formatBytes } from '../store';
import { useStats, useTreeRoot } from '../hooks';

export function Stats() {
  const stats = useStats();
  const rootCidVal = useTreeRoot();

  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-muted">
        {stats.items} items
      </span>
      <span className="text-muted">
        {formatBytes(stats.bytes)}
      </span>
      {rootCidVal && (
        <code className="text-xs text-text-3 font-mono">
          {toHex(rootCidVal.hash).slice(0, 12)}...
        </code>
      )}
    </div>
  );
}
