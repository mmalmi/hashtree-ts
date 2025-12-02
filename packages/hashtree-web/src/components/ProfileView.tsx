import { useState } from 'react';
import { navigate } from '../utils/navigate';
import { useProfile } from '../hooks/useProfile';
import { useFollows, followPubkey, unfollowPubkey } from '../hooks/useFollows';
import { Avatar, Name } from './user';
import { nip19 } from 'nostr-tools';
import { useNostrStore } from '../nostr';

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
  const [copied, setCopied] = useState(false);
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

  const copyUserId = async () => {
    await navigator.clipboard.writeText(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFollow = async () => {
    setFollowLoading(true);
    if (isFollowing) {
      await unfollowPubkey(pubkeyHex);
    } else {
      await followPubkey(pubkeyHex);
    }
    setFollowLoading(false);
  };

  const shortNpub = npub.slice(0, 10) + '...' + npub.slice(-4);

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
          <h1 className="text-xl font-bold text-text-1 m-0">
            <Name pubkey={pubkeyHex} />
          </h1>
          <div className="flex items-center gap-2">
            {isLoggedInVal && isOwnProfile && (
              <>
                <button
                  onClick={() => navigate('/accounts')}
                  className="btn-ghost"
                  title="Switch account"
                >
                  Accounts
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
          </div>
        </div>

        {/* npub with copy */}
        <button
          onClick={copyUserId}
          className="flex items-center gap-1 text-sm text-text-2 hover:text-text-1 bg-transparent border-none cursor-pointer p-0 mt-1"
          title="Copy user ID"
        >
          {copied ? (
            <span className="i-lucide-check text-success text-xs" />
          ) : (
            <span className="i-lucide-copy text-xs" />
          )}
          <span className="font-mono">{shortNpub}</span>
        </button>

        {profile?.nip05 && (
          <div className="text-sm text-accent mt-1">{profile.nip05}</div>
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
