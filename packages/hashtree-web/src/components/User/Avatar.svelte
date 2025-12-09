<script lang="ts">
  import { createProfileStore, getProfileName } from '../../stores/profile';
  import { animalName } from '../../utils/animalName';
  import Minidenticon from './Minidenticon.svelte';
  import Badge from './Badge.svelte';

  interface Props {
    pubkey: string;
    size?: number;
    class?: string;
    showBadge?: boolean;
  }

  let { pubkey, size = 40, class: className = '', showBadge = false }: Props = $props();

  let profileStore = $derived(createProfileStore(pubkey));
  let profile = $derived($profileStore);
  let imgError = $state(false);

  // Reset error state when pubkey changes
  $effect(() => {
    pubkey; // depend on pubkey
    imgError = false;
  });

  let name = $derived(getProfileName(profile, pubkey) || animalName(pubkey));

  // Auto-select badge size based on avatar size
  function getBadgeSize(avatarSize: number): 'sm' | 'md' | 'lg' {
    if (avatarSize <= 32) return 'sm';
    if (avatarSize <= 48) return 'md';
    return 'lg';
  }

  let badgeSize = $derived(getBadgeSize(size));
  let hasPicture = $derived(profile?.picture && !imgError);
</script>

{#if showBadge}
  <div class="relative inline-block">
    {#if hasPicture}
      <img
        src={profile!.picture}
        alt={name}
        title={name}
        width={size}
        height={size}
        class="rounded-full object-cover {className}"
        onerror={() => (imgError = true)}
      />
    {:else}
      <div title={name}>
        <Minidenticon seed={pubkey} {size} class={className} />
      </div>
    {/if}
    <Badge
      pubKeyHex={pubkey}
      size={badgeSize}
      class="absolute -top-0.5 -right-0.5"
    />
  </div>
{:else if hasPicture}
  <img
    src={profile!.picture}
    alt={name}
    title={name}
    width={size}
    height={size}
    class="rounded-full object-cover {className}"
    onerror={() => (imgError = true)}
  />
{:else}
  <div title={name}>
    <Minidenticon seed={pubkey} {size} class={className} />
  </div>
{/if}
