/**
 * Social graph badge component
 * Shows checkmark based on follow distance
 */
import { useFollowDistance, useFollowedByFriends } from '../../utils/socialGraph';
import { useNostrStore } from '../../nostr';

interface BadgeProps {
  pubKeyHex: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeConfig = {
  sm: { badge: 'w-3 h-3', icon: 8 },
  md: { badge: 'w-4 h-4', icon: 10 },
  lg: { badge: 'w-5 h-5', icon: 12 },
};

export function Badge({ pubKeyHex, size = 'md', className = '' }: BadgeProps) {
  const publicKey = useNostrStore((state) => state.pubkey);
  const loggedIn = !!publicKey;
  const distance = useFollowDistance(pubKeyHex);
  const followedByFriends = useFollowedByFriends(pubKeyHex);

  if (!loggedIn || !pubKeyHex) {
    return null;
  }

  // Only show badge for users within 2 degrees
  if (distance > 2) {
    return null;
  }

  let tooltip: string;
  let badgeClass: string;

  if (distance === 0) {
    tooltip = 'You';
    badgeClass = 'bg-blue-500';
  } else if (distance === 1) {
    tooltip = 'Following';
    badgeClass = 'bg-blue-500';
  } else {
    // distance === 2
    const friendCount = followedByFriends.size;
    tooltip = `Followed by ${friendCount} friend${friendCount !== 1 ? 's' : ''}`;
    badgeClass = friendCount > 10 ? 'bg-purple-500' : 'bg-gray-500';
  }

  const { badge, icon } = sizeConfig[size];

  return (
    <span
      className={`rounded-full flex items-center justify-center ${badge} text-white ${badgeClass} ${className}`}
      title={tooltip}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
