<script lang="ts">
  import { onMount } from 'svelte';
  import FileBrowser from '../components/FileBrowser.svelte';
  import Viewer from '../components/Viewer/Viewer.svelte';
  import StreamView from '../components/stream/StreamView.svelte';
  import { nostrStore } from '../nostr';
  import { routeStore, addRecent, isViewingFileStore, currentHash, currentDirCidStore, createGitInfoStore, directoryEntriesStore } from '../stores';
  import { LinkType } from 'hashtree';
  import { updateRecentVisibility } from '../stores/recents';

  interface Props {
    npub?: string;
    treeName?: string;
    wild?: string;
  }

  let { npub, treeName, wild }: Props = $props();

  // Use derived from routeStore for reactivity
  let route = $derived($routeStore);
  let hash = $derived($currentHash);

  // Check if fullscreen mode from URL
  let isFullscreen = $derived.by(() => {
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return false;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    return params.get('fullscreen') === '1';
  });

  // Check if viewing own tree (streaming only allowed on own trees)
  let userNpub = $derived($nostrStore.npub);
  let viewedNpub = $derived(route.npub);
  let isOwnTree = $derived(!viewedNpub || viewedNpub === userNpub);

  // Only enable streaming mode on user's own trees
  let isStreaming = $derived(route.isStreaming && isOwnTree);
  // Check if a file is selected (actual check from hashtree, not heuristic)
  let isViewingFile = $derived($isViewingFileStore);

  // Check if current directory is a git repo
  let currentDirCid = $derived($currentDirCidStore);
  let gitInfoStore = $derived(createGitInfoStore(currentDirCid));
  let gitInfo = $derived($gitInfoStore);
  let isGitRepo = $derived(gitInfo.isRepo);

  // Check if current directory is a Yjs document (contains .yjs file)
  let dirEntries = $derived($directoryEntriesStore);
  let isYjsDocument = $derived(dirEntries.entries.some(e => e.name === '.yjs' && e.type !== LinkType.Dir));

  // On mobile, show viewer for git repos, Yjs docs, or when file/stream selected
  let hasFileSelected = $derived(isViewingFile || isStreaming || isGitRepo || isYjsDocument);

  // Show stream view if streaming and logged in
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let showStreamView = $derived(isStreaming && isLoggedIn);

  onMount(() => {
    // Load tree when route params change
    if (npub && treeName) {
      loadTree(npub, treeName);

      // Track as recent - include linkKey if present
      // Parse linkKey from current URL directly (routeStore may not have updated yet)
      const hash = window.location.hash;
      const qIdx = hash.indexOf('?');
      let linkKey: string | undefined;
      if (qIdx !== -1) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        linkKey = params.get('k') ?? undefined;
      }

      addRecent({
        type: 'tree',
        label: treeName,
        path: `/${npub}/${treeName}`,
        npub,
        treeName,
        linkKey,
      });
    }
  });

  async function loadTree(npubStr: string, treeNameVal: string) {
    try {
      const { getRefResolver, getResolverKey } = await import('../refResolver');
      const { nip19 } = await import('nostr-tools');
      const { toHex } = await import('hashtree');
      const resolver = getRefResolver();
      const key = getResolverKey(npubStr, treeNameVal);

      if (key) {
        let pubkey: string | null = null;
        try {
          const decoded = nip19.decode(npubStr);
          if (decoded.type === 'npub') {
            pubkey = decoded.data as string;
          }
        } catch {}

        resolver.subscribe(key, (cidObj, visibilityInfo) => {
          if (cidObj) {
            const hashHex = toHex(cidObj.hash);
            const keyHex = cidObj.key ? toHex(cidObj.key) : undefined;

            // Update recent item's visibility when resolved
            if (visibilityInfo?.visibility) {
              updateRecentVisibility(`/${npubStr}/${treeNameVal}`, visibilityInfo.visibility);
            }

            if (pubkey) {
              const currentSelected = nostrStore.getState().selectedTree;
              if (!currentSelected || currentSelected.name === treeNameVal) {
                nostrStore.setSelectedTree({
                  id: currentSelected?.id || '',
                  name: treeNameVal,
                  pubkey,
                  rootHash: hashHex,
                  rootKey: keyHex,
                  visibility: visibilityInfo?.visibility ?? 'public',
                  encryptedKey: visibilityInfo?.encryptedKey,
                  keyId: visibilityInfo?.keyId,
                  selfEncryptedKey: visibilityInfo?.selfEncryptedKey,
                  created_at: currentSelected?.created_at || Math.floor(Date.now() / 1000),
                });
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('Failed to load from nostr:', e);
    }
  }
</script>

<!-- File browser - hidden on mobile when file/stream selected, hidden completely in fullscreen -->
{#if !isFullscreen}
  <div class={hasFileSelected
    ? 'hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col min-h-0'
    : 'flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col min-h-0'}>
    <FileBrowser />
  </div>
{/if}
<!-- Right panel (Viewer or StreamView) - shown on mobile when file/stream selected -->
<div class={hasFileSelected || isFullscreen
  ? 'flex flex-1 flex-col min-w-0 min-h-0'
  : 'hidden lg:flex flex-1 flex-col min-w-0 min-h-0'}>
  {#if showStreamView}
    <StreamView />
  {:else}
    <Viewer />
  {/if}
</div>
