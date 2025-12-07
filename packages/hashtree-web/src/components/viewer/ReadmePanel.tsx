/**
 * ReadmePanel - Bordered panel for displaying README.md content
 */
import Markdown from 'markdown-to-jsx';
import type { TreeEntry } from 'hashtree';
import { selectFile } from '../../actions';

interface ReadmePanelProps {
  content: string;
  entries: TreeEntry[];
  canEdit: boolean;
}

export function ReadmePanel({ content, entries, canEdit }: ReadmePanelProps) {
  const handleEdit = () => {
    const readmeEntry = entries.find(
      e => e.name.toLowerCase() === 'readme.md' && !e.isTree
    );
    if (readmeEntry) {
      selectFile(readmeEntry);
    }
  };

  return (
    <div className="bg-surface-0 b-1 b-surface-3 b-solid rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 b-b-1 b-b-solid b-b-surface-3">
        <div className="flex items-center gap-2">
          <span className="i-lucide-book-open text-text-2" />
          <span className="text-sm font-medium">README.md</span>
        </div>
        {canEdit && (
          <button
            onClick={handleEdit}
            className="btn-ghost text-xs px-2 py-1"
          >
            Edit
          </button>
        )}
      </div>
      <div className="p-4 lg:p-6 prose prose-sm max-w-none text-text-1">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}
