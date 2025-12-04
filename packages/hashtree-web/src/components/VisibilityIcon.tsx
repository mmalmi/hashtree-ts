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

export function VisibilityIcon({ visibility, className = '' }: Props) {
  const { icon, title } = getVisibilityInfo(visibility);
  return (
    <span
      className={`shrink-0 ${icon} ${className}`}
      title={title}
    />
  );
}
