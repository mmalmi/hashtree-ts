<script lang="ts">
  /**
   * FollowsTreesView - shows trees from followed users
   * Displays a flat list of trees sorted by created_at (most recent first)
   */
  import { nip19 } from 'nostr-tools';
  import { SvelteMap } from 'svelte/reactivity';
  import { nostrStore } from '../nostr';
  import { createFollowsStore } from '../stores/follows';
  import { createTreesStore, type TreeEntry } from '../stores/trees';
  import { TreeRow } from './ui';

  let pubkey = $derived($nostrStore.pubkey);
  let followsStore = $derived(pubkey ? createFollowsStore(pubkey) : null);
  let follows = $state<string[]>([]);

  // Subscribe to follows store
  $effect(() => {
    if (!followsStore) {
      follows = [];
      return;
    }
    const unsub = followsStore.subscribe(value => {
      follows = value?.follows || [];
    });
    return () => {
      unsub();
      followsStore?.destroy();
    };
  });

  // Tree entry with owner info
  interface TreeWithOwner extends TreeEntry {
    ownerPubkey: string;
    ownerNpub: string;
  }

  let allTrees = $state<TreeWithOwner[]>([]);
  let treeStoreCleanups: (() => void)[] = [];

  // Debounce timer for tree updates to avoid excessive re-sorts
  let updateTimer: ReturnType<typeof setTimeout> | null = null;

  // Create tree stores for each followed user
  $effect(() => {
    // Clean up previous stores
    treeStoreCleanups.forEach(cleanup => cleanup());
    treeStoreCleanups = [];
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }

    if (follows.length === 0) {
      allTrees = [];
      return;
    }

    // Limit to first 50 follows to avoid too many subscriptions
    const limitedFollows = follows.slice(0, 50);
    const treesMap = new SvelteMap<string, TreeEntry[]>();

    // Initialize with empty arrays
    limitedFollows.forEach(pk => treesMap.set(pk, []));

    // Subscribe to each user's trees
    for (const followedPubkey of limitedFollows) {
      let npub: string;
      try {
        npub = nip19.npubEncode(followedPubkey);
      } catch {
        continue;
      }

      const store = createTreesStore(npub);
      const unsub = store.subscribe(trees => {
        // Filter to only public trees (not private or unlisted)
        const publicTrees = trees.filter(t => t.visibility === 'public');
        treesMap.set(followedPubkey, publicTrees);
        // Debounce updates to avoid excessive re-sorts when many subscriptions fire
        scheduleUpdate(treesMap);
      });

      treeStoreCleanups.push(unsub);
    }

    return () => {
      treeStoreCleanups.forEach(cleanup => cleanup());
      treeStoreCleanups = [];
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
    };
  });

  function scheduleUpdate(treesMap: Map<string, TreeEntry[]>) {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateTimer = null;
      updateAllTrees(treesMap);
    }, 50); // 50ms debounce
  }

  function updateAllTrees(treesMap: Map<string, TreeEntry[]>) {
    const result: TreeWithOwner[] = [];
    for (const [pk, trees] of treesMap) {
      let npub: string;
      try {
        npub = nip19.npubEncode(pk);
      } catch {
        continue;
      }
      for (const tree of trees) {
        result.push({
          ...tree,
          ownerPubkey: pk,
          ownerNpub: npub,
        });
      }
    }
    // Sort by createdAt descending (most recent first)
    result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    allTrees = result;
  }

  // Build href for a tree
  function buildTreeHref(ownerNpub: string, treeName: string, linkKey?: string): string {
    const base = `#/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(treeName)}`;
    return linkKey ? `${base}?k=${linkKey}` : base;
  }

  // Format relative time
  function formatTime(timestamp: number | undefined): string {
    if (!timestamp) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60);
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(diff / 86400);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
  }
</script>

<div class="flex-1 flex flex-col min-h-0">
  <div class="flex-1 overflow-auto">
    <!-- Following section -->
    <div class="h-10 shrink-0 px-4 border-b border-surface-3 flex items-center">
      <span class="text-sm font-medium text-text-1">Following</span>
      <span class="ml-2 text-xs text-text-3">{allTrees.length}</span>
    </div>
    {#if allTrees.length === 0}
      <div class="p-4 text-muted text-sm">
        {follows.length === 0 ? 'Not following anyone' : 'No public trees from followed users'}
      </div>
    {:else}
      <div>
        {#each allTrees as tree (tree.key)}
          <TreeRow
            href={buildTreeHref(tree.ownerNpub, tree.name, tree.linkKey)}
            name={tree.name}
            ownerPubkey={tree.ownerPubkey}
            visibility={tree.visibility}
            time={tree.createdAt ? formatTime(tree.createdAt) : null}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
