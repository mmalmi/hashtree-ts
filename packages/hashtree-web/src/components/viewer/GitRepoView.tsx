/**
 * GitRepoView - GitHub-style directory listing with README below
 * Shows branch info, file list table, then README.md in its own panel
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CID, TreeEntry } from 'hashtree';
import { getTree, decodeAsText, formatBytes } from '../../store';
import { useRoute, useCurrentPath } from '../../hooks';
import { useGitInfo, useGitLog } from '../../hooks/useGit';
import { openGitHistoryModal } from '../../hooks/useModals';
import { getFileIcon } from './utils';
import { FolderActions } from '../FolderActions';
import { ReadmePanel } from './ReadmePanel';

interface BranchDropdownProps {
  currentBranch: string | null;
  branches: string[];
  onSelect: (branch: string) => void;
}

function BranchDropdown({ currentBranch, branches, onSelect }: BranchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (branches.length <= 1) {
    // No dropdown needed if only one branch
    return (
      <span className="btn-ghost flex items-center gap-1 px-3 h-9 text-sm cursor-default">
        <span className="i-lucide-git-branch" />
        {currentBranch || 'detached'}
      </span>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
      >
        <span className="i-lucide-git-branch" />
        {currentBranch || 'detached'}
        <span className="i-lucide-chevron-down text-xs" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 b-1 b-solid b-surface-3 rounded shadow-lg z-10 min-w-40 max-h-60 overflow-auto">
          {branches.map((branch) => (
            <button
              key={branch}
              onClick={() => {
                onSelect(branch);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm bg-surface-2 hover:bg-surface-3 flex items-center gap-2 text-text-1 b-0"
            >
              {branch === currentBranch && <span className="i-lucide-check text-accent text-xs" />}
              <span className={branch === currentBranch ? '' : 'ml-4'}>{branch}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const navigate = useNavigate();
  const route = useRoute();
  const currentPath = useCurrentPath();
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const gitInfo = useGitInfo(dirCid);
  const { commits } = useGitLog(dirCid, 1000); // Fetch up to 1000 commits for count

  // Sort entries: directories first, then files, alphabetically
  const sortedEntries = [...entries]
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
    <div className="flex flex-col gap-4">
      {/* Folder actions */}
      <FolderActions dirCid={dirCid} canEdit={canEdit} />

      {/* Directory listing table - GitHub style */}
      <div className="b-1 b-surface-3 b-solid rounded-lg overflow-hidden bg-surface-0">
        {/* Branch info header row */}
        <div className="flex items-center gap-3 px-3 py-2 bg-surface-1 b-b-1 b-b-solid b-b-surface-3 text-sm">
          <BranchDropdown
            currentBranch={gitInfo.currentBranch}
            branches={gitInfo.branches}
            onSelect={(branch) => {
              // TODO: Implement branch checkout
              console.log('Switch to branch:', branch);
            }}
          />
          <button
            onClick={() => openGitHistoryModal(dirCid)}
            className="ml-auto btn-ghost flex items-center gap-1 px-3 h-9 text-sm"
          >
            <span className="i-lucide-history" />
            {commits.length > 0 ? `${commits.length} commits` : 'Commits'}
          </button>
        </div>
        <table className="w-full text-sm border-collapse">
          <tbody>
            {sortedEntries.map((entry) => {
              const isGitDir = entry.name === '.git';
              const href = buildEntryHref(entry, route.npub, route.treeName, currentPath, route.linkKey);
              return (
                <tr
                  key={entry.name}
                  onClick={() => navigate(href)}
                  className={`b-b-1 b-b-solid b-b-surface-3 hover:bg-surface-1 cursor-pointer ${isGitDir ? 'opacity-50' : ''}`}
                >
                  <td className="py-2 px-3 w-8">
                    <span className={`${entry.isTree ? 'i-lucide-folder text-warning' : `${getFileIcon(entry.name)} text-text-2`}`} />
                  </td>
                  <td className={`py-2 px-3 ${isGitDir ? 'text-text-3' : 'text-accent'}`}>
                    {entry.name}
                  </td>
                  <td className="py-2 px-3 text-right text-muted w-24">
                    {!entry.isTree && entry.size !== undefined ? formatBytes(entry.size) : ''}
                  </td>
                </tr>
              );
            })}
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
        <div>
          <ReadmePanel content={readmeContent} entries={entries} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}
