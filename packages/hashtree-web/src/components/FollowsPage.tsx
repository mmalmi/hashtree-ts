import { navigate } from '../utils/navigate';
import { useProfile } from '../hooks/useProfile';
import { useFollows } from '../hooks/useFollows';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { Avatar, Name } from './user';
import { nip19 } from 'nostr-tools';

interface Props {
  npub: string;
}

export function FollowsPage({ npub }: Props) {
  const follows = useFollows(npub);
  const showLoading = useDelayedLoading(!follows);

  const pubkeyHex = (() => {
    try {
      const decoded = nip19.decode(npub);
      return decoded.data as string;
    } catch {
      return '';
    }
  })();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-surface-3 bg-surface-1 shrink-0">
        <button
          onClick={() => navigate(`/${npub}`)}
          className="bg-transparent border-none text-text-2 cursor-pointer p-1 hover:bg-surface-2 rounded"
        >
          <span className="i-lucide-arrow-left text-lg" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-1 truncate">
            <Name pubkey={pubkeyHex} />
          </div>
          <div className="text-xs text-text-2">
            {follows ? `${follows.follows.length} following` : showLoading ? 'Loading...' : ''}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!follows ? (
          showLoading ? <div className="p-4 text-text-2">Loading...</div> : null
        ) : follows.follows.length === 0 ? (
          <div className="p-4 text-text-2">Not following anyone</div>
        ) : (
          <div className="divide-y divide-surface-3">
            {follows.follows.map(pk => (
              <FollowItem key={pk} pubkey={pk} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FollowItem({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const npubStr = nip19.npubEncode(pubkey);

  return (
    <button
      onClick={() => navigate(`/${npubStr}`)}
      className="flex items-center gap-3 p-4 hover:bg-surface-2 bg-transparent border-none cursor-pointer text-left w-full"
    >
      <Avatar pubkey={pubkey} size={44} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-1 truncate">
          <Name pubkey={pubkey} />
        </div>
        {profile?.nip05 && (
          <div className="text-sm text-text-2 truncate">{profile.nip05}</div>
        )}
        {profile?.about && (
          <div className="text-sm text-text-2 mt-1 line-clamp-2">{profile.about}</div>
        )}
      </div>
    </button>
  );
}
