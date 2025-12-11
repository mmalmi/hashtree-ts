<script lang="ts">
  /**
   * Tab navigation for repository views (Code, Pull Requests, Issues)
   */
  interface Props {
    npub: string;
    repoName: string;
    activeTab: 'code' | 'pulls' | 'issues';
  }

  let { npub, repoName, activeTab }: Props = $props();

  const tabs = [
    { id: 'code', label: 'Code', icon: 'i-lucide-code', href: '' },
    { id: 'pulls', label: 'Pull Requests', icon: 'i-lucide-git-pull-request', href: '/pulls' },
    { id: 'issues', label: 'Issues', icon: 'i-lucide-circle-dot', href: '/issues' },
  ] as const;

  function getHref(tab: typeof tabs[number]): string {
    return `#/${npub}/${repoName}${tab.href}`;
  }
</script>

<div class="flex items-center gap-1 px-4 py-2 bg-surface-1 b-b-1 b-b-solid b-b-surface-3">
  {#each tabs as tab}
    <a
      href={getHref(tab)}
      class="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors {
        activeTab === tab.id
          ? 'bg-surface-3 text-text-1 font-medium'
          : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
      }"
    >
      <span class="{tab.icon}"></span>
      {tab.label}
    </a>
  {/each}
</div>
