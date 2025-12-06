/**
 * GitHistoryModal - shows commit history for a git repository
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toHex, nhashEncode } from 'hashtree';
import { useModals, closeGitHistoryModal } from '../../hooks/useModals';
import { useGitLog } from '../../hooks/useGit';
import { checkoutCommit } from '../../utils/git';
import { autosaveIfOwn } from '../../nostr';

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GitHistoryModal() {
  const { showGitHistoryModal, gitHistoryTarget } = useModals();
  const { commits, loading, error } = useGitLog(gitHistoryTarget?.dirCid ?? null);
  const [checkoutInProgress, setCheckoutInProgress] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleCheckout = async (commitSha: string) => {
    if (!gitHistoryTarget) return;

    setCheckoutInProgress(commitSha);
    setCheckoutError(null);

    try {
      const newCid = await checkoutCommit(gitHistoryTarget.dirCid, commitSha);
      // Save the new tree to nostr if this is the user's own tree
      await autosaveIfOwn(newCid);
      // Navigate to the new tree
      const nhash = nhashEncode({
        hash: toHex(newCid.hash),
        decryptKey: newCid.key ? toHex(newCid.key) : undefined
      });
      navigate(`/${nhash}`);
      closeGitHistoryModal();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
      setCheckoutInProgress(null);
    }
  };

  if (!showGitHistoryModal || !gitHistoryTarget) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeGitHistoryModal();
      }}
    >
      <div className="bg-surface-1 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-3">
          <div className="flex items-center gap-2">
            <span className="i-lucide-history text-accent" />
            <h2 className="text-lg font-medium text-text-1">Commit History</h2>
          </div>
          <button
            onClick={closeGitHistoryModal}
            className="text-text-3 hover:text-text-1 transition-colors"
          >
            <span className="i-lucide-x text-xl" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <span className="i-lucide-loader-2 animate-spin text-2xl text-accent" />
            </div>
          )}

          {error && (
            <div className="text-danger text-sm p-4 bg-danger/10 rounded">
              {error}
            </div>
          )}

          {checkoutError && (
            <div className="text-danger text-sm p-4 bg-danger/10 rounded mb-3">
              {checkoutError}
            </div>
          )}

          {!loading && !error && commits.length === 0 && (
            <div className="text-text-3 text-center py-8">
              No commits found
            </div>
          )}

          {!loading && !error && commits.length > 0 && (
            <div className="space-y-3">
              {commits.map((commit) => (
                <div
                  key={commit.oid}
                  className="relative pl-6 pb-3 border-l-2 border-surface-3 last:border-transparent"
                >
                  {/* Timeline dot */}
                  <div className="absolute left-[-5px] top-1 w-2 h-2 rounded-full bg-accent" />

                  {/* Commit content */}
                  <div className="bg-surface-2 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Message */}
                        <div className="text-text-1 text-sm font-medium mb-2 whitespace-pre-wrap">
                          {commit.message.trim()}
                        </div>

                        {/* Meta info */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
                          <span className="font-mono text-accent" title={commit.oid}>
                            {commit.oid.slice(0, 7)}
                          </span>
                          <span>{commit.author}</span>
                          <span>{formatDate(commit.timestamp)} {formatTime(commit.timestamp)}</span>
                        </div>
                      </div>

                      {/* Checkout button */}
                      <button
                        onClick={() => handleCheckout(commit.oid)}
                        disabled={checkoutInProgress !== null}
                        className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 shrink-0"
                        title="Restore this version"
                      >
                        {checkoutInProgress === commit.oid ? (
                          <>
                            <span className="i-lucide-loader-2 animate-spin" />
                            <span>Restoring...</span>
                          </>
                        ) : (
                          <>
                            <span className="i-lucide-history" />
                            <span>Restore</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-3">
          <button
            onClick={closeGitHistoryModal}
            className="btn-ghost px-4 py-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
