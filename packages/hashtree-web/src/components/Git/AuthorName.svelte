<script lang="ts">
  /**
   * Displays author name from profile or truncated npub
   */
  import { createProfileStore, getProfileName } from '../../stores/profile';

  interface Props {
    pubkey: string;
    npub: string;
  }

  let { pubkey, npub }: Props = $props();

  let profileStore = $derived(createProfileStore(pubkey));
  let profile = $derived($profileStore);
  let displayName = $derived(getProfileName(profile) || npub.slice(0, 12) + '...');
</script>

<span class="text-text-2">{displayName}</span>
