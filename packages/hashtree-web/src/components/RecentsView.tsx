/**
 * RecentsView - shows recently visited locations on the home page
 */
import { Link } from 'react-router-dom';
import { useRecents, clearRecents } from '../hooks';
import { npubToPubkey } from '../nostr';
import { Avatar } from './user';

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
          <Link
            key={`${item.path}-${i}`}
            to={item.path}
            className="p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-1"
          >
            {item.npub ? (
              <Avatar pubkey={npubToPubkey(item.npub) || item.npub} size={24} className="shrink-0" />
            ) : (
              <span className="shrink-0 w-6 h-6 flex items-center justify-center">
                <span className="i-lucide-hash text-accent" />
              </span>
            )}
            <span className={`shrink-0 ${getIcon(item.type)}`} />
            <div className="flex-1 min-w-0">
              <div className="truncate">{item.label}</div>
              {item.treeName && (
                <div className="text-xs text-text-3 truncate">
                  {item.treeName}
                </div>
              )}
            </div>
            <span className="text-xs text-text-3 shrink-0">
              {formatTimeAgo(item.timestamp)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function getIcon(type: string): string {
  switch (type) {
    case 'tree':
    case 'dir':
    case 'hash': // Legacy: treat old hash items as directories
      return 'i-lucide-folder text-warning';
    case 'file':
      return 'i-lucide-file text-text-2';
    default:
      return 'i-lucide-folder text-warning';
  }
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}
