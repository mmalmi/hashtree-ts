/**
 * TreeRow - shared row component for tree/file listings
 */
import { Link } from 'react-router-dom';
import type { TreeVisibility } from 'hashtree';
import { navigate } from '../utils/navigate';
import { Avatar, Name } from './user';
import { VisibilityIcon } from './VisibilityIcon';

export interface TreeRowProps {
  to: string;
  pubkey?: string;
  npub?: string;
  icon: 'folder' | 'file' | 'hash';
  label: string;
  subtitle?: string;
  showAuthorName?: boolean;
  timestamp: number;
  /** @deprecated Use visibility instead */
  encrypted?: boolean;
  visibility?: TreeVisibility;
}

export function TreeRow({
  to,
  pubkey,
  npub,
  icon,
  label,
  subtitle,
  showAuthorName,
  timestamp,
  encrypted,
  visibility,
}: TreeRowProps) {
  const typeIconClass = icon === 'folder'
    ? 'i-lucide-folder text-warning'
    : icon === 'file'
      ? 'i-lucide-file text-text-2'
      : 'i-lucide-folder text-warning'; // hash items show folder icon

  return (
    <Link
      to={to}
      className="p-3 border-b border-surface-2 flex items-center gap-3 no-underline text-text-1 hover:bg-surface-1"
    >
      {pubkey && npub ? (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/${npub}`); }}
          className="shrink-0 bg-transparent border-none p-0 cursor-pointer hover:opacity-80"
        >
          <Avatar pubkey={pubkey} size={24} showBadge />
        </button>
      ) : (
        <span className="shrink-0 w-6 h-6 flex items-center justify-center">
          <span className="i-lucide-hash text-accent" />
        </span>
      )}
      <span className={`shrink-0 ${typeIconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="truncate">{label}</div>
        {(subtitle || showAuthorName) && (
          <div className="text-xs text-text-3 truncate">
            {showAuthorName && pubkey ? <Name pubkey={pubkey} /> : subtitle}
          </div>
        )}
      </div>
      {visibility !== undefined ? (
        <VisibilityIcon visibility={visibility} className="text-text-3" />
      ) : encrypted !== undefined && (
        <span
          className={`shrink-0 ${encrypted ? 'i-lucide-lock' : 'i-lucide-globe'} text-text-3`}
          title={encrypted ? 'Encrypted' : 'Public'}
        />
      )}
      <span className="text-xs text-text-3 shrink-0">
        {formatTimeAgo(timestamp)}
      </span>
    </Link>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}
