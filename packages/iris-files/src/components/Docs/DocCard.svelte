<script lang="ts">
  /**
   * DocCard - A4 aspect ratio document card for docs grid
   */
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import { Avatar } from '../User';

  interface Props {
    href: string;
    displayName: string;
    ownerPubkey?: string | null;
    visibility?: string;
  }

  let { href, displayName, ownerPubkey, visibility }: Props = $props();
</script>

<a
  {href}
  class="aspect-[1/1.414] bg-surface-1 rounded-lg border border-surface-3 hover:border-accent hover:shadow-md transition-all no-underline flex flex-col"
>
  <div class="flex-1 flex items-center justify-center">
    <span class="i-lucide-file-text text-4xl text-accent"></span>
  </div>
  <div class="p-2 border-t border-surface-3">
    <div class="flex items-center gap-1.5">
      {#if ownerPubkey}
        <Avatar pubkey={ownerPubkey} size={16} />
      {/if}
      <VisibilityIcon {visibility} class="text-text-3 text-xs" />
      <h3 class="text-sm font-medium text-text-1 truncate">{displayName}</h3>
    </div>
  </div>
</a>
