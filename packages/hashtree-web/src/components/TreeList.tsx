import { useNostrStore, npubToPubkey } from '../nostr';
import { useRoute } from '../hooks';
import { useTrees } from '../hooks/useTrees';
import { UserRow } from './user';
import { VisibilityIcon } from './VisibilityIcon';

interface Props {
  onSelect: (rootHash: string, name: string, ownerNpub: string) => void;
  onNewTree: () => void;
}

export function TreeList({ onSelect, onNewTree }: Props) {
  const route = useRoute();
  const viewedNpub = route.npub;
  const isLoggedInVal = useNostrStore(s => s.isLoggedIn);
  const npubVal = useNostrStore(s => s.npub);
  const selectedTreeName = route.treeName;

  // Use resolver subscription for live tree updates
  const targetNpub = viewedNpub || npubVal;
  const trees = useTrees(targetNpub);

  const handleSelect = (tree: typeof trees[0]) => {
    onSelect(tree.hashHex, tree.name, targetNpub!);
  };

  // Show new tree button only when viewing own trees (or no specific user)
  const isOwnTrees = !viewedNpub || viewedNpub === npubVal;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-3">
      <div className="mb-3">
        {viewedNpub ? (
          <UserRow pubkey={npubToPubkey(viewedNpub) || viewedNpub} avatarSize={32} className="min-w-0" />
        ) : (
          <span className="text-xs text-muted uppercase tracking-wide">Trees</span>
        )}
      </div>

      {isLoggedInVal && isOwnTrees && (
        <button
          onClick={onNewTree}
          className="w-full bg-surface-2 border border-dashed border-surface-3 rounded-sm text-muted py-1.5 cursor-pointer text-xs mb-2 flex items-center justify-center gap-1"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Tree
        </button>
      )}

      <div className="flex-1 overflow-auto">
        {trees.length === 0 ? (
          <p className="text-muted text-xs m-0">
            {isLoggedInVal || viewedNpub ? 'No trees' : 'Login to see trees'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {trees.map((tree) => (
              <div
                key={tree.key}
                onClick={() => handleSelect(tree)}
                className={`py-1.5 px-2 rounded-sm cursor-pointer text-sm flex items-center gap-2 ${
                  selectedTreeName === tree.name ? 'bg-surface-2' : 'hover:bg-surface-2/50'
                }`}
              >
                <span className="truncate">{tree.name}</span>
                <VisibilityIcon visibility={tree.visibility} className="ml-auto text-text-3" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
