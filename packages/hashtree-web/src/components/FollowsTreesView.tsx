/**
 * FollowsTreesView - shows trees from followed users on the home page
 * Includes both direct follows and 2nd degree (follows of follows)
 */
import { useFollowsTrees } from '../hooks/useFollowsTrees';
import { TreeRow } from './TreeRow';

export function FollowsTreesView() {
  const { trees, loading, followsCount, secondDegreeCount } = useFollowsTrees();

  // Don't show anything while loading (no spinner)
  if (loading) {
    return null;
  }

  // Split trees by distance
  const directTrees = trees.filter(t => t.distance === 1);
  const secondDegreeTrees = trees.filter(t => t.distance === 2);

  const hasAnyTrees = trees.length > 0;
  const hasDirectTrees = directTrees.length > 0;
  const hasSecondDegreeTrees = secondDegreeTrees.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Direct follows section */}
      <div className="px-4 py-3 border-b border-surface-3">
        <span className="text-sm font-medium text-text-2">Follows</span>
      </div>
      {!hasDirectTrees ? (
        <div className="p-3 text-text-3 text-sm">
          {followsCount === 0
            ? 'No follows yet'
            : `No trees from ${followsCount} follow${followsCount === 1 ? '' : 's'}`}
        </div>
      ) : (
        <div className="overflow-auto">
          {directTrees.map((tree) => (
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

      {/* 2nd degree section - only show if we have 2nd degree users in graph */}
      {secondDegreeCount > 0 && (
        <>
          <div className="px-4 py-3 border-b border-surface-3 mt-2">
            <span className="text-sm font-medium text-text-2">Network</span>
            <span className="text-xs text-text-3 ml-2">follows of follows</span>
          </div>
          {!hasSecondDegreeTrees ? (
            <div className="p-3 text-text-3 text-sm">
              No trees from {secondDegreeCount} network user{secondDegreeCount === 1 ? '' : 's'}
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {secondDegreeTrees.map((tree) => (
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
        </>
      )}

      {/* Show empty state only if no trees at all and no network */}
      {!hasAnyTrees && secondDegreeCount === 0 && followsCount === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-text-3 p-8">
          <span className="i-lucide-users text-4xl mb-3" />
          <span className="text-sm">Follow users to see their trees</span>
        </div>
      )}
    </div>
  );
}
