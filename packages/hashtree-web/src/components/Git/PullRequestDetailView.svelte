<script lang="ts">
  /**
   * PullRequestDetailView - Shows a single pull request with comments
   * Layout matches TreeRoute: FileBrowser on left, content on right
   */
  import { nostrStore } from '../../nostr';
  import {
    decodeEventId,
    fetchComments,
    addComment,
    updateStatus,
    buildRepoAddress,
    type PullRequest,
    type Comment,
    type ItemStatus,
  } from '../../nip34';
  import ItemStatusBadge from './ItemStatusBadge.svelte';
  import RepoTabNav from './RepoTabNav.svelte';
  import AuthorName from './AuthorName.svelte';
  import FileBrowser from '../FileBrowser.svelte';
  import { ndk } from '../../nostr';
  import { KIND_PULL_REQUEST } from '../../utils/constants';

  interface Props {
    npub: string;
    repoName: string;
    prId: string; // nevent or hex
  }

  let { npub, repoName, prId }: Props = $props();

  // Decode the PR ID
  let eventId = $derived(decodeEventId(prId) || prId);

  // State
  let pr: PullRequest | null = $state(null);
  let comments: Comment[] = $state([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newComment = $state('');
  let submitting = $state(false);

  // Check if user can interact
  let userPubkey = $derived($nostrStore.pubkey);
  let canComment = $derived(!!userPubkey);
  let isAuthor = $derived(pr?.authorPubkey === userPubkey);
  let isOwner = $derived(false); // TODO: check if user is repo owner

  // Fetch PR and comments
  $effect(() => {
    if (eventId) {
      loadPR();
    }
  });

  async function loadPR() {
    loading = true;
    error = null;

    try {
      // Fetch the PR event directly by ID with a timeout
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
      const event = await Promise.race([ndk.fetchEvent(eventId), timeoutPromise]);
      if (!event) {
        error = 'Pull request not found';
        loading = false;
        return;
      }

      // Parse the PR event
      const tags = event.tags;
      const title = tags.find(t => t[0] === 'subject')?.[1] || tags.find(t => t[0] === 'title')?.[1] || 'Untitled PR';
      const branch = tags.find(t => t[0] === 'branch')?.[1];
      const targetBranch = tags.find(t => t[0] === 'target-branch')?.[1] || 'main';
      const commitTip = tags.find(t => t[0] === 'c')?.[1];
      const cloneUrl = tags.find(t => t[0] === 'clone')?.[1];
      const labels = tags.filter(t => t[0] === 't').map(t => t[1]);

      pr = {
        id: event.id!,
        eventId: event.id!,
        title,
        description: event.content || '',
        author: '', // Will be set below
        authorPubkey: event.pubkey!,
        status: 'open', // TODO: fetch actual status
        branch,
        targetBranch,
        commitTip,
        cloneUrl,
        created_at: event.created_at || 0,
        updated_at: event.created_at || 0,
        labels,
      };

      // Set author npub
      const { pubkeyToNpub } = await import('../../nostr');
      pr.author = pubkeyToNpub(event.pubkey!);

      // Fetch comments
      comments = await fetchComments(eventId);
    } catch (e) {
      console.error('Failed to load pull request:', e);
      error = 'Failed to load pull request';
    } finally {
      loading = false;
    }
  }

  async function handleSubmitComment() {
    if (!newComment.trim() || !pr || submitting) return;

    submitting = true;
    try {
      const repoAddress = buildRepoAddress(npub, repoName);
      const comment = await addComment(eventId, pr.authorPubkey, newComment.trim(), repoAddress);
      if (comment) {
        comments = [...comments, comment];
        newComment = '';
      }
    } catch (e) {
      console.error('Failed to add comment:', e);
    } finally {
      submitting = false;
    }
  }

  async function handleStatusChange(newStatus: ItemStatus) {
    if (!pr) return;

    const success = await updateStatus(eventId, pr.authorPubkey, newStatus);
    if (success) {
      pr = { ...pr, status: newStatus };
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function getBackHref(): string {
    return `#/${npub}/${repoName}?tab=pulls`;
  }
</script>

<!-- File browser on left (same as TreeRoute) -->
<div class="flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col min-h-0">
  <FileBrowser />
</div>

<!-- Right panel with PR detail -->
<div class="hidden lg:flex flex-1 flex-col min-w-0 min-h-0 bg-surface-0">
  <!-- Tab navigation -->
  <RepoTabNav {npub} {repoName} activeTab="pulls" />

  <!-- Content -->
  <div class="flex-1 overflow-auto">
    {#if loading}
      <div class="flex items-center justify-center py-12 text-text-3">
        <span class="i-lucide-loader-2 animate-spin mr-2"></span>
        Loading pull request...
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center py-12 text-danger">
        <span class="i-lucide-alert-circle text-2xl mb-2"></span>
        <span>{error}</span>
        <a href={getBackHref()} class="btn-ghost mt-4">
          <span class="i-lucide-arrow-left mr-2"></span>
          Back to pull requests
        </a>
      </div>
    {:else if pr}
      <!-- Header -->
      <div class="p-4 b-b-1 b-b-solid b-b-surface-3">
        <div class="flex items-start gap-3">
          <a href={getBackHref()} class="mt-1 text-text-3 hover:text-text-1">
            <span class="i-lucide-arrow-left"></span>
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <h1 class="text-xl font-semibold text-text-1">{pr.title}</h1>
              <ItemStatusBadge status={pr.status} type="pr" />
            </div>
            <div class="text-sm text-text-3">
              <AuthorName pubkey={pr.authorPubkey} npub={pr.author} />
              wants to merge
              {#if pr.branch}
                <span class="font-mono bg-surface-2 px-1 rounded">{pr.branch}</span>
              {/if}
              into
              <span class="font-mono bg-surface-2 px-1 rounded">{pr.targetBranch || 'main'}</span>
            </div>
            <div class="text-sm text-text-3 mt-1">
              Opened on {formatDate(pr.created_at)}
            </div>
            {#if pr.labels.length > 0}
              <div class="flex gap-2 mt-2 flex-wrap">
                {#each pr.labels as label}
                  <span class="px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent">{label}</span>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Status actions -->
          {#if isOwner}
            <div class="flex gap-2">
              {#if pr.status === 'open'}
                <button onclick={() => handleStatusChange('merged')} class="btn-primary text-sm">
                  <span class="i-lucide-git-merge mr-1"></span>
                  Merge
                </button>
                <button onclick={() => handleStatusChange('closed')} class="btn-ghost text-sm">
                  <span class="i-lucide-circle-x mr-1"></span>
                  Close
                </button>
              {:else if pr.status === 'closed'}
                <button onclick={() => handleStatusChange('open')} class="btn-ghost text-sm">
                  <span class="i-lucide-git-pull-request mr-1"></span>
                  Reopen
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Branch info / Clone URL -->
      {#if pr.cloneUrl || pr.commitTip}
        <div class="p-4 b-b-1 b-b-solid b-b-surface-3 bg-surface-1">
          <div class="text-sm">
            {#if pr.cloneUrl}
              <div class="flex items-center gap-2 mb-1">
                <span class="text-text-3">Clone:</span>
                <code class="text-text-2 font-mono">{pr.cloneUrl}</code>
              </div>
            {/if}
            {#if pr.commitTip}
              <div class="flex items-center gap-2">
                <span class="text-text-3">Commit:</span>
                <code class="text-text-2 font-mono">{pr.commitTip.slice(0, 8)}</code>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Description -->
      {#if pr.description}
        <div class="p-4 b-b-1 b-b-solid b-b-surface-3">
          <div class="prose prose-sm max-w-none text-text-2 whitespace-pre-wrap">{pr.description}</div>
        </div>
      {/if}

      <!-- Comments -->
      <div class="p-4">
        <h2 class="text-sm font-medium text-text-2 mb-4">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </h2>

        {#if comments.length > 0}
          <div class="space-y-4 mb-6">
            {#each comments as comment (comment.id)}
              <div class="bg-surface-1 rounded-lg p-4">
                <div class="flex items-center gap-2 mb-2 text-sm text-text-3">
                  <AuthorName pubkey={comment.authorPubkey} npub={comment.author} />
                  <span>·</span>
                  <span>{formatDate(comment.created_at)}</span>
                </div>
                <div class="text-text-1 whitespace-pre-wrap">{comment.content}</div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- New comment form -->
        {#if canComment}
          <div class="bg-surface-1 rounded-lg p-4">
            <textarea
              bind:value={newComment}
              placeholder="Leave a comment..."
              class="w-full bg-surface-0 border border-surface-3 rounded-md p-3 text-text-1 placeholder-text-3 resize-none min-h-24"
              disabled={submitting}
            ></textarea>
            <div class="flex justify-end mt-2">
              <button
                onclick={handleSubmitComment}
                disabled={!newComment.trim() || submitting}
                class="btn-primary"
              >
                {#if submitting}
                  <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                {/if}
                Comment
              </button>
            </div>
          </div>
        {:else}
          <p class="text-sm text-text-3">Sign in to comment on this pull request.</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
