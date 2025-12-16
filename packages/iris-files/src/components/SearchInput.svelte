<script lang="ts">
  import { nhashEncode, isNHash, isNPath } from 'hashtree';
  import { nip19 } from 'nostr-tools';
  import Fuse from 'fuse.js';
  import { nostrStore } from '../nostr';
  import { follows } from '../utils/socialGraph';
  import { UserRow } from './User';

  interface Props {
    fullWidth?: boolean;
    autofocus?: boolean;
  }

  let { fullWidth = false, autofocus = false }: Props = $props();

  let inputRef: HTMLInputElement | undefined = $state();

  // Match 64 hex chars optionally followed by /filename
  const HASH_PATTERN = /^([a-f0-9]{64})(\/.*)?$/i;

  interface SearchResult {
    pubkey: string;
    npub: string;
  }

  let value = $state('');
  let focused = $state(false);
  let showDropdown = $state(false);
  let selectedIndex = $state(0);
  let containerRef: HTMLDivElement | undefined = $state();

  let userPubkey = $derived($nostrStore.pubkey);
  let userFollows = $derived(follows(userPubkey));

  // Create fuse index from followed users
  let fuseIndex = $derived.by(() => {
    if (!userFollows || userFollows.size === 0) return null;

    const searchItems: SearchResult[] = [];
    for (const pubkey of userFollows) {
      try {
        const npub = nip19.npubEncode(pubkey);
        searchItems.push({ pubkey, npub });
      } catch {
        // Skip invalid pubkeys
      }
    }

    return new Fuse(searchItems, {
      keys: ['npub', 'pubkey'],
      includeScore: true,
      threshold: 0.4,
    });
  });

  // Search results
  let searchResults = $derived.by(() => {
    if (!fuseIndex || !value.trim() || value.trim().length < 2) return [];
    const results = fuseIndex.search(value.trim(), { limit: 5 });
    return results.map(r => r.item);
  });

  // Reset selection when results change
  $effect(() => {
    searchResults; // depend on results
    selectedIndex = 0;
  });

  // Autofocus when requested
  $effect(() => {
    if (autofocus && inputRef) {
      inputRef.focus();
    }
  });

  // Close dropdown when clicking outside
  $effect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        showDropdown = false;
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  function navigateTo(input: string): boolean {
    let trimmed = input.trim();

    // Extract hash fragment from full URL and navigate directly
    try {
      const url = new URL(trimmed);
      if (url.hash && url.hash.startsWith('#/')) {
        window.location.hash = url.hash;
        value = '';
        return true;
      }
    } catch {
      // Not a URL
    }

    // Handle raw #/ paths pasted directly
    if (trimmed.startsWith('#/')) {
      window.location.hash = trimmed;
      value = '';
      return true;
    }

    // npub
    if (trimmed.startsWith('npub1') && trimmed.length >= 63) {
      window.location.hash = `#/${trimmed}`;
      value = '';
      return true;
    }

    // nhash or npath
    if (isNHash(trimmed) || isNPath(trimmed)) {
      window.location.hash = `#/${trimmed}`;
      value = '';
      return true;
    }

    // Hex hash with optional path
    const hashMatch = trimmed.match(HASH_PATTERN);
    if (hashMatch) {
      const hash = hashMatch[1];
      const path = hashMatch[2] || '';
      const nhash = nhashEncode(hash);
      window.location.hash = `#/${nhash}${path}`;
      value = '';
      return true;
    }

    // Route path (e.g. npub1.../treename)
    if (trimmed.startsWith('npub1')) {
      window.location.hash = `#/${trimmed}`;
      value = '';
      return true;
    }

    return false;
  }

  function handleSelectUser(result: SearchResult) {
    window.location.hash = `#/${result.npub}`;
    value = '';
    showDropdown = false;
  }

  function handleInput(e: Event) {
    const newValue = (e.target as HTMLInputElement).value.trim();
    if (!navigateTo(newValue)) {
      value = (e.target as HTMLInputElement).value;
      showDropdown = true;
    } else {
      showDropdown = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (showDropdown && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        return;
      }
      if (e.key === 'Enter' && searchResults[selectedIndex]) {
        e.preventDefault();
        handleSelectUser(searchResults[selectedIndex]);
        return;
      }
    }
    if (e.key === 'Enter') {
      navigateTo(value.trim());
      showDropdown = false;
    }
    if (e.key === 'Escape') {
      showDropdown = false;
    }
  }
</script>

<div bind:this={containerRef} class="relative">
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border transition-colors {focused ? 'border-accent' : 'border-surface-3'}">
    <span class="i-lucide-search text-sm text-muted shrink-0" />
    <input
      bind:this={inputRef}
      type="text"
      bind:value
      oninput={handleInput}
      onkeydown={handleKeyDown}
      onfocus={() => { focused = true; showDropdown = true; }}
      onblur={() => (focused = false)}
      placeholder="Search users or paste hash..."
      class="bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted {fullWidth ? 'flex-1' : 'w-40 lg:w-64'}"
    />
  </div>

  <!-- Search results dropdown -->
  {#if showDropdown && searchResults.length > 0}
    <div class="absolute top-full left-0 right-0 mt-1 bg-surface-2 rounded border border-surface-3 shadow-lg z-50 max-h-64 overflow-auto">
      {#each searchResults as result, index}
        <button
          onclick={() => handleSelectUser(result)}
          onmouseenter={() => (selectedIndex = index)}
          class="w-full px-3 py-2 text-left {index === selectedIndex ? 'bg-surface-3' : 'hover:bg-surface-3'}"
        >
          <UserRow pubkey={result.pubkey} avatarSize={28} />
        </button>
      {/each}
    </div>
  {/if}
</div>

