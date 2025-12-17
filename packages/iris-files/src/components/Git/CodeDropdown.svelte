<script lang="ts">
  /**
   * CodeDropdown - GitHub-style green "<> Code" button with clone instructions
   */
  interface Props {
    npub: string;
    repoPath: string;
  }

  let { npub, repoPath }: Props = $props();

  let isOpen = $state(false);
  let copied = $state(false);

  // Build the htree:// clone URL
  let cloneUrl = $derived(`htree://${npub}/${repoPath}`);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(`git clone ${cloneUrl}`);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

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
    <div class="absolute right-0 top-full mt-1 w-80 bg-surface-1 b-1 b-surface-3 b-solid rounded-lg shadow-lg z-50 overflow-hidden">
      <!-- Header -->
      <div class="px-3 py-2 bg-surface-2 b-b b-surface-3 b-solid">
        <span class="text-sm font-medium text-text-1">Clone</span>
      </div>

      <!-- Content -->
      <div class="p-3 space-y-3">
        <!-- Clone URL -->
        <div>
          <label class="text-xs text-text-3 mb-1 block">htree URL</label>
          <div class="flex items-center gap-2">
            <input
              type="text"
              readonly
              value={cloneUrl}
              class="flex-1 input text-xs font-mono bg-surface-2 px-2 py-1.5"
              onclick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onclick={copyToClipboard}
              class="btn-ghost p-1.5 shrink-0"
              title="Copy clone command"
            >
              {#if copied}
                <span class="i-lucide-check text-success"></span>
              {:else}
                <span class="i-lucide-copy"></span>
              {/if}
            </button>
          </div>
        </div>

        <!-- Instructions -->
        <div class="text-xs text-text-3 space-y-2">
          <p class="font-medium text-text-2">To clone this repository:</p>
          <ol class="list-decimal list-inside space-y-1.5 text-text-3">
            <li>
              Install the CLI:
              <code class="bg-surface-2 px-1 py-0.5 rounded text-text-2">cargo install hashtree-cli</code>
            </li>
            <li>
              Clone the repo:
              <code class="bg-surface-2 px-1 py-0.5 rounded text-text-2 break-all">git clone {cloneUrl}</code>
            </li>
          </ol>
        </div>

        <!-- Links -->
        <div class="pt-2 b-t b-surface-3 b-solid">
          <a
            href="https://github.com/irislib/hashtree-rs"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-accent hover:underline flex items-center gap-1"
          >
            <span class="i-lucide-external-link"></span>
            Learn more about hashtree-cli
          </a>
        </div>
      </div>
    </div>
  {/if}
</div>
