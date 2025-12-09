<script lang="ts">
  import { createProfileStore, getProfileName } from '../../stores/profile';
  import { animalName } from '../../utils/animalName';

  interface Props {
    pubkey: string;
    class?: string;
  }

  let { pubkey, class: className = '' }: Props = $props();

  let profileStore = $derived(createProfileStore(pubkey));
  let profile = $derived($profileStore);
  let profileName = $derived(getProfileName(profile, pubkey));
  let animal = $derived(animalName(pubkey));
</script>

{#if profileName}
  <span class="truncate {className}">{profileName}</span>
{:else}
  <!-- Animal name fallback (styled differently) -->
  <span class="truncate italic opacity-70 {className}">
    {animal}
  </span>
{/if}
