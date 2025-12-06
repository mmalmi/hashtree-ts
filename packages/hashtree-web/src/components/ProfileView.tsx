import { useState } from 'react';
import { navigate } from '../utils/navigate';
import { useProfile } from '../hooks/useProfile';
import { useFollows, followPubkey, unfollowPubkey } from '../hooks/useFollows';
import { Avatar, Name, FollowedBy, Badge } from './user';
import { CopyText } from './CopyText';
import { nip19 } from 'nostr-tools';
import { useNostrStore } from '../nostr';
import { useFollowsMe, useFollowers } from '../utils/socialGraph';
import { openShareModal } from '../hooks/useModals';

interface Props {
  npub: string;
}

export function ProfileView({ npub }: Props) {
  const myPubkeyVal = useNostrStore(s => s.pubkey);
  const isLoggedInVal = useNostrStore(s => s.isLoggedIn);

  const profile = useProfile(npub);
  const follows = useFollows(npub);
  const myFollows = useFollows(myPubkeyVal || undefined);
  const [bannerError, setBannerError] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const pubkeyHex = (() => {
    try {
      const decoded = nip19.decode(npub);
      return decoded.data as string;
    } catch {
      return '';
    }
  })();

  const isOwnProfile = myPubkeyVal === pubkeyHex;
  const isFollowing = myFollows?.follows.includes(pubkeyHex) ?? false;
  const followsMe = useFollowsMe(pubkeyHex);
  const knownFollowers = useFollowers(pubkeyHex);

  const handleFollow = async () => {
    setFollowLoading(true);
    if (isFollowing) {
      await unfollowPubkey(pubkeyHex);
    } else {
      await followPubkey(pubkeyHex);
    }
    setFollowLoading(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0 overflow-y-auto">
      {/* Banner */}
      <div className="h-32 md:h-40 bg-surface-2 relative shrink-0">
        {profile?.banner && !bannerError && (
          <img
            src={profile.banner}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setBannerError(true)}
          />
        )}
      </div>

      {/* Profile header */}
      <div className="px-4 pb-4 -mt-12 relative">
        {/* Avatar */}
        <div className="mb-3">
          <Avatar pubkey={pubkeyHex} size={80} className="border-4 border-surface-0" />
        </div>

        {/* Name and action buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-xl font-bold text-text-1 m-0 truncate">
              <Name pubkey={pubkeyHex} />
            </h1>
            {isOwnProfile ? (
              <span className="shrink-0 text-xs text-blue-500 flex items-center gap-1">
                <Badge pubKeyHex={pubkeyHex} size="sm" /> You
              </span>
            ) : isFollowing ? (
              <span className="shrink-0 text-xs text-blue-500 flex items-center gap-1">
                <Badge pubKeyHex={pubkeyHex} size="sm" /> Following
              </span>
            ) : null}
            {!isOwnProfile && followsMe && (
              <span className="shrink-0 text-xs bg-surface-2 text-text-2 px-2 py-0.5 rounded">
                Follows you
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isLoggedInVal && isOwnProfile && (
              <>
                <button
                  onClick={() => navigate('/users')}
                  className="btn-ghost"
                  title="Switch user"
                >
                  Users
                </button>
                <button
                  onClick={() => navigate(`/${npub}/edit`)}
                  className="btn-ghost"
                >
                  Edit Profile
                </button>
              </>
            )}
            {isLoggedInVal && !isOwnProfile && (
              <button
                onClick={handleFollow}
                disabled={followLoading}
                className={isFollowing ? 'btn-ghost' : 'btn-success'}
              >
                {followLoading ? '...' : isFollowing ? 'Unfollow' : 'Follow'}
              </button>
            )}
            <button
              onClick={() => openShareModal(window.location.href)}
              className="btn-ghost"
              title="Share"
            >
              <span className="i-lucide-share text-base" />
            </button>
          </div>
        </div>

        {/* npub with copy */}
        <CopyText text={npub} displayText={npub.slice(0, 8) + '...' + npub.slice(-4)} className="text-sm mt-1" />

        {profile?.nip05 && (
          <div className="text-sm text-accent mt-1">{profile.nip05}</div>
        )}

        {/* Followed by friends */}
        {!isOwnProfile && pubkeyHex && (
          <FollowedBy pubkey={pubkeyHex} className="mt-2" />
        )}

        {/* About */}
        {profile?.about && (
          <p className="text-sm text-text-2 mt-3 whitespace-pre-wrap break-words">
            {profile.about}
          </p>
        )}

        {/* Stats */}
        <div className="flex gap-4 mt-4 text-sm">
          <button
            onClick={() => navigate(`/${npub}/follows`)}
            className="bg-transparent border-none cursor-pointer p-0 text-text-2 hover:text-text-1"
          >
            <span className="font-bold text-text-1">{follows?.follows.length ?? '...'}</span> Following
          </button>
          {knownFollowers.size > 0 && (
            <span className="text-text-2">
              <span className="font-bold text-text-1">{knownFollowers.size}</span> known followers
            </span>
          )}
        </div>

        {/* Website */}
        {profile?.website && (
          <a
            href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent mt-3 inline-block hover:underline"
          >
            {profile.website}
          </a>
        )}
      </div>
    </div>
  );
}
