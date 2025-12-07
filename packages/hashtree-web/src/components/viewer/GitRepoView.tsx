/**
 * GitRepoView - GitHub-style directory listing with README below
 * Shows branch info, file list table, then README.md in its own panel
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'markdown-to-jsx';
import type { CID, TreeEntry } from 'hashtree';
import { getTree, decodeAsText, formatBytes } from '../../store';
import { selectFile } from '../../actions';
import { useRoute, useCurrentPath, useCurrentDirCid } from '../../hooks';
import { useGitInfo, useGitLog } from '../../hooks/useGit';
import { openGitHistoryModal } from '../../hooks/useModals';
import { getFileIcon } from './utils';
import { FolderActions } from '../FolderActions';

interface GitRepoViewProps {
  dirCid: CID;
  entries: TreeEntry[];
  canEdit: boolean;
}

// Build href for an entry
function buildEntryHref(
  entry: TreeEntry,
  npub: string | null,
  treeName: string | null,
  currentPath: string[],
  linkKey: string | null
): string {
  const parts: string[] = [];
  const suffix = linkKey ? `?k=${linkKey}` : '';

  if (npub && treeName) {
    parts.push(npub, treeName, ...currentPath, entry.name);
    return '/' + parts.map(encodeURIComponent).join('/') + suffix;
  }

  parts.push(...currentPath, entry.name);
  return '/' + parts.map(encodeURIComponent).join('/') + suffix;
}

export function GitRepoView({ dirCid, entries, canEdit }: GitRepoViewProps) {
  const route = useRoute();
  const currentPath = useCurrentPath();
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const gitInfo = useGitInfo(dirCid);
  const { commits } = useGitLog(dirCid, 1000); // Fetch up to 1000 commits for count

  // Sort entries: directories first, then files, alphabetically
  // Filter out .git directory
  const sortedEntries = [...entries]
    .filter(e => e.name !== '.git')
    .sort((a, b) => {
      if (a.isTree && !b.isTree) return -1;
      if (!a.isTree && b.isTree) return 1;
      return a.name.localeCompare(b.name);
    });

  // Find and load README.md
  useEffect(() => {
    setReadmeContent(null);
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && !e.isTree
    );
    if (!readmeEntry) return;

    let cancelled = false;
    getTree().readFile(readmeEntry.cid).then(data => {
      if (!cancelled && data) {
        const text = decodeAsText(data);
        if (text) setReadmeContent(text);
      }
    });
    return () => { cancelled = true; };
  }, [entries]);

  return (
    <div className="h-full overflow-auto">
      {/* Folder actions */}
      <div className="p-3">
        <FolderActions dirCid={dirCid} canEdit={canEdit} />
      </div>

      {/* Directory listing table - GitHub style */}
      <div className="border border-surface-3 rounded-lg mx-4 overflow-hidden bg-surface-0">
        {/* Branch info header row */}
        <div className="flex items-center gap-3 px-3 py-2 bg-surface-1 border-b border-surface-3 text-sm">
          <span className="i-lucide-git-branch text-text-2" />
          <span className="font-medium">{gitInfo.currentBranch || 'detached'}</span>
          <button
            onClick={() => openGitHistoryModal(dirCid)}
            className="ml-auto text-accent hover:underline flex items-center gap-1"
          >
            <span className="i-lucide-history" />
            <span>{commits.length > 0 ? `${commits.length} commits` : 'Commits'}</span>
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {sortedEntries.map((entry) => (
              <tr
                key={entry.name}
                className="border-b border-surface-3 last:border-b-0 hover:bg-surface-1"
              >
                <td className="py-2 px-3 w-8">
                  <span className={`${entry.isTree ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}`} />
                </td>
                <td className="py-2 px-3">
                  <Link
                    to={buildEntryHref(entry, route.npub, route.treeName, currentPath, route.linkKey)}
                    className="text-accent hover:underline no-underline"
                  >
                    {entry.name}
                  </Link>
                </td>
                <td className="py-2 px-3 text-right text-muted w-24">
                  {!entry.isTree && entry.size !== undefined ? formatBytes(entry.size) : ''}
                </td>
              </tr>
            ))}
            {sortedEntries.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 px-3 text-center text-muted">
                  Empty directory
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* README.md panel */}
      {readmeContent && (
        <div className="border border-surface-3 rounded-lg mx-4 mt-4 mb-4 overflow-hidden bg-surface-0">
          <div className="flex items-center justify-between px-4 py-2 bg-surface-1 border-b border-surface-3">
            <div className="flex items-center gap-2">
              <span className="i-lucide-book-open text-text-2" />
              <span className="text-sm font-medium">README.md</span>
            </div>
            {canEdit && (
              <button
                onClick={() => {
                  const readmeEntry = entries.find(
                    e => e.name.toLowerCase() === 'readme.md' && !e.isTree
                  );
                  if (readmeEntry) {
                    selectFile(readmeEntry);
                  }
                }}
                className="btn-ghost text-xs px-2 py-1"
              >
                Edit
              </button>
            )}
          </div>
          <div className="p-4 lg:p-6 prose prose-sm max-w-none text-text-1">
            <Markdown>{readmeContent}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
