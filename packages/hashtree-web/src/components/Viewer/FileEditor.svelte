<script lang="ts">
  /**
   * FileEditor - textarea editor for text files
   * Port of React Viewer edit functionality
   */
  import { saveFile } from '../../actions';

  interface Props {
    fileName: string;
    initialContent: string;
    onDone: () => void;
  }

  let { fileName, initialContent, onDone }: Props = $props();

  let editContent = $state(initialContent);
  let saved = $state(false);
  let saving = $state(false);

  async function handleSave() {
    saving = true;
    await saveFile(fileName, editContent);
    saved = true;
    saving = false;
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="shrink-0 px-3 py-2 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
    <span class="i-lucide-file-text text-text-2"></span>
    <span class="font-medium text-text-1">{fileName}</span>
    <span class="text-xs text-muted">(editing)</span>
    <div class="ml-auto flex items-center gap-2">
      <button onclick={handleSave} disabled={saving} class="btn-success">
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
      </button>
      <button onclick={onDone} class="btn-ghost">
        Done
      </button>
    </div>
  </div>

  <!-- Editor -->
  <textarea
    bind:value={editContent}
    onkeydown={handleKeyDown}
    class="flex-1 w-full p-4 bg-surface-0 text-text-1 font-mono text-sm resize-none focus:outline-none"
    spellcheck="false"
  ></textarea>
</div>
