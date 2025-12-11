<script lang="ts">
  /**
   * Displays author with avatar, name, and social graph badge
   */
  import Avatar from '../User/Avatar.svelte';
  import Name from '../User/Name.svelte';

  interface Props {
    pubkey: string;
    npub?: string;
    size?: 'sm' | 'md';
  }

  let { pubkey, size = 'sm' }: Props = $props();

  let avatarSize = $derived(size === 'sm' ? 20 : 28);
</script>

<span class="inline-flex items-center gap-1.5">
  <Avatar {pubkey} size={avatarSize} showBadge={true} />
  <Name {pubkey} class="text-text-2 hover:text-accent hover:underline" />
</span>
