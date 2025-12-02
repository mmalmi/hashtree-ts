/**
 * RecentsView - shows recently visited locations on the home page
 */
import { useRecents, clearRecents } from '../hooks';
import { npubToPubkey } from '../nostr';
import { TreeRow } from './TreeRow';

export function RecentsView() {
  const recents = useRecents();

  if (recents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-3 p-8">
        <span className="i-lucide-clock text-4xl mb-3" />
        <span className="text-sm">No recent activity</span>
        <span className="text-xs mt-1">Visit a folder to see it here</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-surface-3 flex items-center justify-between">
        <span className="text-sm font-medium text-text-2">Recent</span>
        <button
          onClick={() => clearRecents()}
          className="btn-ghost text-xs px-2 py-1"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {recents.map((item, i) => (
          <TreeRow
            key={`${item.path}-${i}`}
            to={item.path}
            pubkey={item.npub ? npubToPubkey(item.npub) || undefined : undefined}
            npub={item.npub}
            icon={getIcon(item.type)}
            label={item.label}
            subtitle={item.treeName}
            timestamp={item.timestamp}
          />
        ))}
      </div>
    </div>
  );
}

function getIcon(type: string): 'folder' | 'file' | 'hash' {
  switch (type) {
    case 'tree':
    case 'dir':
    case 'hash':
      return 'folder';
    case 'file':
      return 'file';
    default:
      return 'folder';
  }
}
