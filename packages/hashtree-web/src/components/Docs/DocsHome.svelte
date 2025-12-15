<script lang="ts">
  /**
   * DocsHome - Home page for docs.iris.to
   * Shows recent docs, docs by followed users, and new doc button
   * Similar to Google Docs home page
   */
  import { nostrStore } from '../../nostr';
  import { createTreesStore } from '../../stores';
  import { openCreateModal } from '../../stores/modals';
  import VisibilityIcon from '../VisibilityIcon.svelte';

  // Get current user (use $ prefix to auto-subscribe and react to login changes)
  let userNpub = $derived($nostrStore.npub);

  // Get user's trees (which include yjs docs)
  let treesStore = $derived(createTreesStore(userNpub));
  let trees = $state<Array<{ name: string; visibility?: string; rootHash?: string; linkKey?: string }>>([]);

  $effect(() => {
    const store = treesStore;
    const unsub = store.subscribe(value => {
      trees = value;
    });
    return unsub;
  });

  // Filter to only show document trees (docs/ prefix)
  let recentDocs = $derived(
    trees
      .filter(t => t.name.startsWith('docs/'))
      .map(t => ({ ...t, displayName: t.name.slice(5) })) // Remove 'docs/' prefix for display
      .slice(0, 10)
  );

  // Create new document
  function createNewDoc() {
    if (!userNpub) {
      alert('Please sign in to create a document');
      return;
    }
    openCreateModal('document');
  }
</script>

<div class="flex-1 overflow-auto">
  <div class="max-w-4xl mx-auto p-6">
    {#if userNpub}
      <!-- Documents grid with A4 aspect ratio cards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <!-- New Document card -->
        <button
          onclick={createNewDoc}
          class="aspect-[1/1.414] bg-surface-1 rounded-lg border border-dashed border-surface-3 hover:border-accent transition-colors cursor-pointer flex flex-col items-center justify-center gap-2"
        >
          <span class="i-lucide-plus text-4xl text-accent"></span>
          <span class="text-sm text-text-2">New Document</span>
        </button>

        <!-- Recent documents -->
        {#each recentDocs as doc}
          {@const linkKeySuffix = doc.linkKey ? `?k=${doc.linkKey}` : ''}
          <a
            href="#/{userNpub}/{doc.name}{linkKeySuffix}"
            class="aspect-[1/1.414] bg-surface-1 rounded-lg border border-surface-3 hover:border-accent transition-colors no-underline flex flex-col"
          >
            <div class="flex-1 flex items-center justify-center">
              <span class="i-lucide-file-text text-4xl text-accent"></span>
            </div>
            <div class="p-2 border-t border-surface-3">
              <div class="flex items-center gap-1.5">
                <VisibilityIcon visibility={doc.visibility} class="text-text-3 text-xs" />
                <h3 class="text-sm font-medium text-text-1 truncate">{doc.displayName}</h3>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>
