<script lang="ts">
  /**
   * VideoComments - NIP-22 comments for videos
   * Subscribes to comments from Nostr relays and shows them as they arrive
   * Filter to social graph (users with follow distance) on by default, toggleable
   */
  import { untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk, nostrStore } from '../../nostr';
  import { Avatar, Name } from '../User';
  import { NDKEvent, type NDKFilter, type NDKSubscription } from '@nostr-dev-kit/ndk';
  import { getFollowDistance } from '../../utils/socialGraph';

  interface Props {
    npub?: string;  // Optional - may not be available for nhash paths
    treeName?: string;
    nhash?: string;  // For content-addressed permalinks
  }

  let { npub, treeName, nhash }: Props = $props();

  // Derive owner pubkey from npub if available
  let ownerPubkey = $derived.by(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {}
    return null;
  });

  interface Comment {
    id: string;
    content: string;
    authorPubkey: string;
    createdAt: number;
    replyTo?: string;
  }

  let allComments = $state<Comment[]>([]);
  let newComment = $state('');
  let submitting = $state(false);
  let showUnknown = $state(true); // Show all comments by default
  let subscription = $state<NDKSubscription | null>(null);
  const seenIds = new Set<string>();

  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let userPubkey = $derived($nostrStore.pubkey);

  // Filter comments by social graph
  let comments = $derived.by(() => {
    if (showUnknown) return allComments;
    return allComments.filter(c => {
      const distance = getFollowDistance(c.authorPubkey);
      return distance < 1000; // 1000 = not in graph
    });
  });

  let unknownCount = $derived(allComments.length - allComments.filter(c => getFollowDistance(c.authorPubkey) < 1000).length);

  // Comment identifiers - we may have both npub/treeName and nhash for cross-linking
  // Using 'i' tag per NIP-22 for the identifier of the thing being commented on
  // Format matches likes: ${npub}/${treeName} for npub routes, nhash for permalinks
  let npubId = $derived(npub && treeName ? `${npub}/${treeName}` : null);
  let nhashId = $derived(nhash || null);

  // Primary identifier for subscribing
  // On nhash routes (no npub), use nhash. On npub routes, use npubId (nhash is just for writing)
  let primaryId = $derived(npubId || nhashId);

  // Subscribe to comments when primaryId changes
  $effect(() => {
    const id = primaryId;
    if (!id) return;

    untrack(() => subscribeToComments(id));

    return () => {
      if (subscription) {
        subscription.stop();
      }
    };
  });

  function subscribeToComments(id: string) {
    // Reset state for new identifier
    allComments = [];
    seenIds.clear();

    // Subscribe to NIP-22 comments (kind 1111) for this video
    const filter: NDKFilter = {
      kinds: [1111 as number], // NIP-22 GenericReply
      '#i': [id],
    };

    subscription = ndk.subscribe(filter, { closeOnEose: false });

    subscription.on('event', (event: NDKEvent) => {
      if (!event.id || !event.pubkey) return;
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);

      const comment: Comment = {
        id: event.id,
        content: event.content || '',
        authorPubkey: event.pubkey,
        createdAt: event.created_at || 0,
      };

      // Insert in sorted order (newest first)
      const index = allComments.findIndex(c => c.createdAt < comment.createdAt);
      if (index === -1) {
        allComments = [...allComments, comment];
      } else {
        allComments = [...allComments.slice(0, index), comment, ...allComments.slice(index)];
      }
    });
  }

  async function submitComment() {
    if (!newComment.trim() || !isLoggedIn || submitting || !primaryId) return;

    submitting = true;
    try {
      const event = new NDKEvent(ndk);
      event.kind = 1111; // NIP-22 GenericReply
      event.content = newComment.trim();

      // Build tags - i for identifier, p for author
      const tags: string[][] = [];
      if (nhashId) tags.push(['i', nhashId]);
      if (npubId) tags.push(['i', npubId]);

      // Add p tag only if we know the owner
      if (ownerPubkey) {
        tags.push(['p', ownerPubkey]);
      }

      event.tags = tags;

      // Sign first to get the event ID before publishing
      await event.sign();

      // Add to seenIds BEFORE publishing to prevent race condition with subscription
      if (event.id) {
        seenIds.add(event.id);
        // Add to local list immediately
        allComments = [{
          id: event.id,
          content: event.content,
          authorPubkey: userPubkey || '',
          createdAt: event.created_at || Math.floor(Date.now() / 1000),
        }, ...allComments];
      }

      // Now publish (subscription won't add duplicate because ID is already in seenIds)
      await event.publish();

      newComment = '';
    } catch (e) {
      console.error('Failed to post comment:', e);
      alert('Failed to post comment');
    } finally {
      submitting = false;
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }
</script>

<div class="border-t border-surface-3 pt-6 pb-12">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-lg font-semibold text-text-1">
      Comments {#if allComments.length > 0}<span class="text-text-3 font-normal">({allComments.length})</span>{/if}
    </h2>

    <!-- Filter checkbox -->
    {#if allComments.length > 0}
      <label class="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={showUnknown}
          class="w-4 h-4 accent-accent"
        />
        Show comments by unknown users{#if unknownCount > 0} ({unknownCount}){/if}
      </label>
    {/if}
  </div>

  <!-- Add comment -->
  {#if isLoggedIn}
    <div class="flex gap-3 mb-6">
      <div class="shrink-0">
        <Avatar pubkey={userPubkey || ''} size={40} />
      </div>
      <div class="flex-1">
        <textarea
          bind:value={newComment}
          placeholder="Add a comment..."
          class="w-full bg-surface-1 border border-surface-3 rounded-lg p-3 text-text-1 resize-none focus:border-accent focus:outline-none"
          rows="2"
        ></textarea>
        <div class="flex justify-end mt-2">
          <button
            onclick={submitComment}
            disabled={!newComment.trim() || submitting}
            class="btn-primary px-4 py-2 disabled:opacity-50"
          >
            {submitting ? 'Posting...' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="bg-surface-1 rounded-lg p-4 text-center text-text-3 mb-6">
      Sign in to leave a comment
    </div>
  {/if}

  <!-- Comments list -->
  {#if comments.length === 0}
    <div class="text-center py-8 text-text-3">
      {#if !showUnknown && unknownCount > 0}
        No comments from people you follow.
        <button onclick={() => showUnknown = true} class="text-accent hover:underline ml-1">
          Show all {unknownCount}
        </button>
      {:else}
        No comments yet. Be the first to comment!
      {/if}
    </div>
  {:else}
    <div class="space-y-4">
      {#each comments as comment (comment.id)}
        <div class="flex gap-3">
          <a href={`#/${nip19.npubEncode(comment.authorPubkey)}`} class="shrink-0">
            <Avatar pubkey={comment.authorPubkey} size={40} />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <a href={`#/${nip19.npubEncode(comment.authorPubkey)}`} class="font-medium text-text-1 hover:text-accent no-underline">
                <Name pubkey={comment.authorPubkey} />
              </a>
              <span class="text-xs text-text-3">{formatTime(comment.createdAt)}</span>
            </div>
            <p class="text-text-2 whitespace-pre-wrap break-words">{comment.content}</p>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
