/**
 * FollowedBy component - shows which friends follow a user
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Avatar } from './Avatar';
import { Name } from './Name';
import { useFollowedByFriends, useFollowDistance } from '../../utils/socialGraph';
import { useNostrStore } from '../../nostr';

const MAX_AVATARS = 3;
const MAX_NAMES = 3;

interface Props {
  pubkey: string;
  className?: string;
}

export function FollowedBy({ pubkey, className = '' }: Props) {
  const myPubkey = useNostrStore((state) => state.pubkey);
  const followDistance = useFollowDistance(pubkey);
  const followedByFriends = useFollowedByFriends(pubkey);

  const { friendsArray, total } = useMemo(() => {
    const arr = Array.from(followedByFriends);
    return {
      friendsArray: arr.slice(0, MAX_AVATARS),
      total: arr.length,
    };
  }, [followedByFriends]);

  // Don't show for self
  if (pubkey === myPubkey) {
    return null;
  }

  // No friends follow this user
  if (total === 0) {
    if (followDistance === 1) {
      return (
        <div className={`text-sm text-text-2 ${className}`}>
          Followed by you
        </div>
      );
    }
    if (followDistance <= 3) {
      return (
        <div className={`text-sm text-text-2 ${className}`}>
          {followDistance === 3 ? 'Followed by friends of friends' : 'Not followed by anyone you follow'}
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Avatar stack */}
      <div className="flex -space-x-2">
        {friendsArray.map((pk) => (
          <Link
            key={pk}
            to={`/${nip19.npubEncode(pk)}`}
            className="rounded-full ring-2 ring-surface-0 hover:z-10"
          >
            <Avatar pubkey={pk} size={24} />
          </Link>
        ))}
      </div>

      {/* Names */}
      <div className="text-sm text-text-2 min-w-0 truncate">
        <span>Followed by </span>
        {friendsArray.slice(0, MAX_NAMES).map((pk, i) => (
          <span key={pk}>
            {i > 0 && (i === friendsArray.length - 1 || i === MAX_NAMES - 1 ? ' and ' : ', ')}
            <Link
              to={`/${nip19.npubEncode(pk)}`}
              className="text-text-1 hover:underline"
            >
              <Name pubkey={pk} />
            </Link>
          </span>
        ))}
        {total > MAX_NAMES && (
          <span> and {total - MAX_NAMES} other{total - MAX_NAMES !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  );
}
