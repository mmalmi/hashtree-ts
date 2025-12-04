/**
 * VisibilityIcon - displays icon for tree visibility level
 */
import type { TreeVisibility } from 'hashtree';

interface Props {
  visibility: TreeVisibility;
  className?: string;
}

/**
 * Get icon class and title for a visibility level
 * Note: For 'unlisted', use VisibilityIcon or LinkLockIcon component for the combined link+lock icon
 */
export function getVisibilityInfo(visibility: TreeVisibility): { icon: string; title: string } {
  switch (visibility) {
    case 'public':
      return { icon: 'i-lucide-globe', title: 'Public' };
    case 'unlisted':
      return { icon: 'i-lucide-link', title: 'Unlisted (link only)' };
    case 'private':
      return { icon: 'i-lucide-lock', title: 'Private' };
  }
}

/**
 * LinkLockIcon - combined link icon with small lock in bottom-right corner
 * Used for unlisted visibility and encrypted permalinks
 */
export function LinkLockIcon({ className = '', title }: { className?: string; title?: string }) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`} title={title}>
      <span className="i-lucide-link" />
      <span className="i-lucide-lock absolute -bottom-0.5 -right-1.5 text-[0.6em]" />
    </span>
  );
}

export function VisibilityIcon({ visibility, className = '' }: Props) {
  const { title } = getVisibilityInfo(visibility);

  // For unlisted, show combined link + small lock icon (bottom-right corner)
  if (visibility === 'unlisted') {
    return <LinkLockIcon className={className} title={title} />;
  }

  const icon = visibility === 'public' ? 'i-lucide-globe' : 'i-lucide-lock';
  return (
    <span
      className={`shrink-0 ${icon} ${className}`}
      title={title}
    />
  );
}
