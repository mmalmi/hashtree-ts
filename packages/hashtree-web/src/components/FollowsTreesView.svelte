<script lang="ts">
  /**
   * FollowsTreesView - shows trees from followed users
   */
  import { nostrStore } from '../nostr';
  import { createFollowsStore } from '../stores/follows';

  let pubkey = $derived($nostrStore.pubkey);
  let followsStore = $derived(pubkey ? createFollowsStore(pubkey) : null);
  let follows = $derived(followsStore ? $followsStore : null);
  let followCount = $derived(follows?.follows?.length ?? 0);
</script>

<div class="flex-1 flex flex-col min-h-0">
  <div class="h-10 shrink-0 px-4 border-b border-surface-3 flex items-center bg-surface-1">
    <span class="text-sm font-medium text-text-1">Following</span>
  </div>
  <div class="flex-1 overflow-auto p-4 text-muted text-sm">
    {#if followCount === 0}
      Not following anyone
    {:else}
      No trees from followed users
    {/if}
  </div>
</div>
