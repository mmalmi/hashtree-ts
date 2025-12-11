<script lang="ts">
  /**
   * PullRequestsView - Lists pull requests for a repository using NIP-34
   */
  import { routeStore, createPullRequestsStore, filterByStatus, countByStatus, openNewPullRequestModal } from '../../stores';
  import { nostrStore } from '../../nostr';
  import type { PullRequest, ItemStatus } from '../../nip34';
  import ItemStatusBadge from './ItemStatusBadge.svelte';
  import ItemListHeader from './ItemListHeader.svelte';
  import RepoTabNav from './RepoTabNav.svelte';
  import AuthorName from './AuthorName.svelte';

  interface Props {
    npub: string;
    repoName: string;
  }

  let { npub, repoName }: Props = $props();

  // Create store for this repo's PRs
  let prStore = $derived(createPullRequestsStore(npub, repoName));
  let prState = $derived($prStore);

  // Filter PRs
  let filteredPRs = $derived(filterByStatus(prState.items, prState.filter));
  let counts = $derived(countByStatus(prState.items));

  // Check if user can create PRs (logged in)
  let userNpub = $derived($nostrStore.npub);
  let canCreate = $derived(!!userNpub);

  function handleFilterChange(filter: ItemStatus | 'all') {
    prStore.setFilter(filter);
  }

  function handleNewPR() {
    openNewPullRequestModal(npub, repoName, () => {
      // Refresh the list after creating
      prStore.refresh();
    });
  }

  function navigateToPR(pr: PullRequest) {
    const route = $routeStore;
    if (route.npub && route.treeName) {
      window.location.hash = `/${route.npub}/${route.treeName}/pulls/${pr.id}`;
    }
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes}m ago`;
      }
      return `${hours}h ago`;
    }
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return date.toLocaleDateString();
  }
</script>

<div class="flex flex-col h-full bg-surface-0">
  <!-- Tab navigation -->
  <RepoTabNav {npub} {repoName} activeTab="pulls" />

  <!-- Header with filter and new PR button -->
  <ItemListHeader
    type="pr"
    {counts}
    filter={prState.filter}
    onFilterChange={handleFilterChange}
    onNew={handleNewPR}
    {canCreate}
  />

  <!-- PR list -->
  <div class="flex-1 overflow-auto">
    {#if prState.loading}
      <div class="flex items-center justify-center py-12 text-text-3">
        <span class="i-lucide-loader-2 animate-spin mr-2"></span>
        Loading pull requests...
      </div>
    {:else if prState.error}
      <div class="flex flex-col items-center justify-center py-12 text-danger">
        <span class="i-lucide-alert-circle text-2xl mb-2"></span>
        <span>{prState.error}</span>
        <button onclick={() => prStore.refresh()} class="btn-ghost mt-2 text-sm">
          Try again
        </button>
      </div>
    {:else if filteredPRs.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-text-3">
        <span class="i-lucide-git-pull-request text-4xl mb-4 opacity-50"></span>
        {#if prState.items.length === 0}
          <span class="text-lg mb-2">No pull requests yet</span>
          <span class="text-sm">Pull requests let you tell others about changes you've pushed</span>
        {:else}
          <span>No {prState.filter} pull requests</span>
        {/if}
      </div>
    {:else}
      <div class="divide-y divide-surface-3">
        {#each filteredPRs as pr (pr.id)}
          <button
            onclick={() => navigateToPR(pr)}
            class="w-full text-left px-4 py-3 hover:bg-surface-1 flex items-start gap-3 b-0 bg-transparent"
          >
            <!-- Status icon -->
            <div class="mt-1">
              <ItemStatusBadge status={pr.status} type="pr" />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-text-1 truncate">{pr.title}</span>
                {#each pr.labels as label}
                  <span class="px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent">{label}</span>
                {/each}
              </div>
              <div class="text-sm text-text-3">
                opened {formatDate(pr.created_at)} by
                <AuthorName pubkey={pr.authorPubkey} npub={pr.author} />
                {#if pr.branch}
                  <span class="mx-1">•</span>
                  <span class="font-mono text-xs bg-surface-2 px-1 rounded">{pr.branch}</span>
                  <span class="i-lucide-arrow-right text-xs mx-1"></span>
                  <span class="font-mono text-xs bg-surface-2 px-1 rounded">{pr.targetBranch || 'main'}</span>
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
