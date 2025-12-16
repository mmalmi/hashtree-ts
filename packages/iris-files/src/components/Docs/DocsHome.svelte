<script lang="ts">
  /**
   * DocsHome - Home page for docs.iris.to
   * Shows recent docs and new doc button
   * Similar to Google Docs home page
   */
  import { nip19 } from 'nostr-tools';
  import { nostrStore } from '../../nostr';
  import { recentsStore, type RecentItem } from '../../stores/recents';
  import { openCreateModal } from '../../stores/modals';
  import DocCard from './DocCard.svelte';

  // Get current user
  let userNpub = $derived($nostrStore.npub);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);

  // Get recents and filter to only docs
  let recents = $derived($recentsStore);
  let recentDocs = $derived(
    recents
      .filter(r => r.treeName?.startsWith('docs/'))
      .map(r => ({
        ...r,
        displayName: r.treeName ? r.treeName.slice(5) : r.label, // Remove 'docs/' prefix
        ownerPubkey: r.npub ? npubToPubkey(r.npub) : null,
      }))
      .slice(0, 20)
  );

  function npubToPubkey(npub: string): string | null {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }
    } catch {}
    return null;
  }

  function buildHref(item: RecentItem): string {
    const base = `#${item.path}`;
    return item.linkKey ? `${base}?k=${item.linkKey}` : base;
  }

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
    <!-- Documents grid with A4 aspect ratio cards -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      <!-- New Document card (only when logged in) -->
      {#if isLoggedIn}
        <button
          onclick={createNewDoc}
          class="aspect-[1/1.414] bg-surface-1 rounded-lg border border-dashed border-surface-3 hover:border-accent transition-colors cursor-pointer flex flex-col items-center justify-center gap-2"
        >
          <span class="i-lucide-plus text-4xl text-accent"></span>
          <span class="text-sm text-text-2">New Document</span>
        </button>
      {/if}

      <!-- Recent documents -->
      {#each recentDocs as doc}
        <DocCard
          href={buildHref(doc)}
          displayName={doc.displayName}
          ownerPubkey={doc.ownerPubkey}
          visibility={doc.visibility}
        />
      {/each}
    </div>
  </div>
</div>
