<script lang="ts">
  /**
   * FileEditor - textarea editor for text files
   * Port of React Viewer edit functionality
   */
  import { saveFile } from '../../actions';
  import { openUnsavedChangesModal } from '../../stores/modals';

  interface Props {
    fileName: string;
    initialContent: string;
    onDone: () => void;
  }

  let { fileName, initialContent, onDone }: Props = $props();

  let editContent = $state(initialContent);
  let savedContent = $state(initialContent); // Track last saved content
  let saving = $state(false);

  // Track if content has been modified since last save
  let isDirty = $derived(editContent !== savedContent);

  async function handleSave() {
    saving = true;
    await saveFile(fileName, editContent);
    savedContent = editContent; // Update saved content after successful save
    saving = false;
  }

  // Show "Saved!" briefly after saving
  let showSaved = $derived(!isDirty && savedContent !== initialContent);

  function handleClose() {
    if (isDirty) {
      openUnsavedChangesModal({
        fileName,
        onSave: async () => {
          await handleSave();
          onDone();
        },
        onDiscard: () => {
          onDone();
        },
      });
    } else {
      onDone();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    // ESC to close (with unsaved changes check)
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  }

  // Global ESC handler (for when textarea doesn't have focus)
  $effect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't handle if a modal is open (check if any modal backdrop exists)
        if (document.querySelector('[data-modal-backdrop]')) return;

        e.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  });
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0">
  <!-- Header -->
  <div class="shrink-0 px-3 py-2 border-b border-surface-3 flex items-center gap-2 bg-surface-1">
    <span class="i-lucide-file-text text-text-2"></span>
    <span class="font-medium text-text-1">{fileName}</span>
    <span class="text-xs text-muted">(editing{isDirty ? ' - unsaved' : ''})</span>
    <div class="ml-auto flex items-center gap-2">
      <button onclick={handleSave} disabled={saving} class="btn-success">
        {saving ? 'Saving...' : showSaved ? 'Saved!' : 'Save'}
      </button>
      <button onclick={handleClose} class="btn-ghost">
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
