/**
 * FollowsTreesView - shows trees from followed users on the home page
 */
import { useFollowsTrees } from '../hooks/useFollowsTrees';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { TreeRow } from './TreeRow';

export function FollowsTreesView() {
  const { trees, loading, followsCount } = useFollowsTrees();
  const showLoading = useDelayedLoading(loading);

  if (loading && !showLoading) {
    return null;
  }

  if (showLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-3 p-8">
        <span className="i-lucide-loader-2 animate-spin text-2xl mb-3" />
        <span className="text-sm">Loading follows...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-surface-3">
        <span className="text-sm font-medium text-text-2">Follows</span>
      </div>
      {trees.length === 0 ? (
        <div className="p-3 text-text-3 text-sm">
          {followsCount === 0
            ? 'No follows yet'
            : `No trees from ${followsCount} follow${followsCount === 1 ? '' : 's'}`}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
        {trees.map((tree) => (
          <TreeRow
            key={`${tree.pubkey}-${tree.name}`}
            to={`/${tree.npub}/${encodeURIComponent(tree.name)}`}
            pubkey={tree.pubkey}
            npub={tree.npub}
            icon="folder"
            label={tree.name}
            showAuthorName
            timestamp={tree.created_at * 1000}
            visibility={tree.visibility}
          />
        ))}
        </div>
      )}
    </div>
  );
}
