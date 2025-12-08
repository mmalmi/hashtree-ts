<script lang="ts">
  import { onMount } from 'svelte';
  // Wallet will be implemented later, for now use a placeholder
  let totalBalance = $state(0);

  onMount(() => {
    // Initialize wallet - placeholder for now
  });
</script>

<a href="#/wallet" class="flex flex-col items-center text-text-2 hover:text-text-1 p-1 no-underline">
  <span class="i-lucide-wallet text-base" />
  <span class="text-[10px] leading-none">{totalBalance}</span>
</a>
