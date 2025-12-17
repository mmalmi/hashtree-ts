<script lang="ts">
  /**
   * CodeDropdown - GitHub-style green "<> Code" button with clone instructions
   */
  import CopyText from '../CopyText.svelte';

  interface Props {
    npub: string;
    repoPath: string;
  }

  let { npub, repoPath }: Props = $props();

  let isOpen = $state(false);

  // Build the git clone command
  let cloneCommand = $derived(`git clone htree://${npub}/${repoPath}`);
  const rustCommand = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh";
  const cargoCommand = "cargo install git-remote-htree";

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.code-dropdown')) {
      isOpen = false;
    }
  }

  $effect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  });
</script>

<div class="relative code-dropdown">
  <button
    onclick={() => isOpen = !isOpen}
    class="flex items-center gap-1.5 px-3 h-8 rounded-md text-sm font-medium text-white bg-success hover:brightness-110 transition-all"
  >
    <span class="i-lucide-code text-base"></span>
    <span>Code</span>
    <span class="i-lucide-chevron-down text-xs ml-0.5"></span>
  </button>

  {#if isOpen}
    <div class="absolute right-0 top-full mt-1 w-96 bg-surface-1 b-1 b-surface-3 b-solid rounded-lg shadow-lg z-50 overflow-hidden">
      <!-- Header -->
      <div class="px-3 py-2 bg-surface-2 b-b b-surface-3 b-solid">
        <span class="text-sm font-medium text-text-1">Clone</span>
      </div>

      <!-- Content -->
      <div class="p-3 space-y-3">
        <!-- Clone URL -->
        <div>
          <CopyText text={cloneCommand} class="text-xs bg-surface-2 px-2 py-1.5 rounded block" />
        </div>

        <!-- Requirements -->
        <div class="space-y-2">
          <p class="text-xs text-text-3">
            Requires <a href="https://rustup.rs" target="_blank" rel="noopener" class="text-accent hover:underline">Rust</a> and <a href="#/npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk/hashtree-rs" class="text-accent hover:underline">git-remote-htree</a>
          </p>
          <CopyText text={rustCommand} class="text-xs bg-surface-2 px-2 py-1 rounded block" />
          <CopyText text={cargoCommand} class="text-xs bg-surface-2 px-2 py-1 rounded block" />
        </div>
      </div>
    </div>
  {/if}
</div>
