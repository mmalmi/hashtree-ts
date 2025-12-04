/**
 * FollowsTreesView - shows trees from followed users on the home page
 */
import { useFollowsTrees } from '../hooks/useFollowsTrees';
import { TreeRow } from './TreeRow';

export function FollowsTreesView() {
  const { trees, loading, followsCount } = useFollowsTrees();

  // Don't show anything while loading (no spinner)
  if (loading) {
    return null;
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
