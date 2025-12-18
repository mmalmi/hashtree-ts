<script lang="ts">
  /**
   * VideoView - Video player page
   * Shows video player, metadata, owner info, and comments
   *
   * Uses Service Worker streaming via /htree/ URLs (no blob URLs!)
   */
  import { onMount, untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { getTree } from '../../store';
  import { ndk, nostrStore } from '../../nostr';
  import { treeRootStore, createTreesStore } from '../../stores';
  import { openShareModal, openBlossomPushModal } from '../../stores/modals';
  import type { TreeVisibility } from 'hashtree';
  import { deleteTree } from '../../nostr';
  import { updateLocalRootCacheHex } from '../../treeRootCache';
  import { addRecent } from '../../stores/recents';
  import { Avatar, Name } from '../User';
  import { BackButton, Truncate } from '../ui';
  import VisibilityIcon from '../VisibilityIcon.svelte';
  import VideoComments from './VideoComments.svelte';
  import { getFollowers, socialGraphStore } from '../../utils/socialGraph';
  import type { CID, LinkType } from 'hashtree';
  import { toHex, nhashEncode } from 'hashtree';
  import { getNpubFileUrl, getNhashFileUrl } from '../../lib/mediaUrl';
  import { NDKEvent, type NDKFilter, type NDKSubscription } from '@nostr-dev-kit/ndk';

  let deleting = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let editTitle = $state('');
  let editDescription = $state('');

  // Like state
  let likes = $state<Set<string>>(new Set()); // Set of pubkeys who liked
  let userLiked = $state(false);
  let liking = $state(false);

  interface Props {
    npub?: string;
    videoName?: string;
  }

  let { npub, videoName }: Props = $props();

  // Full tree name is videos/{videoName}
  let treeName = $derived(videoName ? `videos/${videoName}` : undefined);

  let videoSrc = $state<string>('');  // SW URL (not blob!)
  let videoFileName = $state<string>('');  // For MIME type detection
  let loading = $state(true);
  let error = $state<string | null>(null);
  let videoTitle = $state<string>('');
  let videoDescription = $state<string>('');
  let videoCid = $state<CID | null>(null);
  let videoVisibility = $state<TreeVisibility>('public');

  // Derive owner pubkey
  let ownerPubkey = $derived.by(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {}
    return null;
  });

  // Video title from title.txt or video name
  let title = $derived(videoTitle || videoName || 'Video');

  // Current user
  let currentUserNpub = $derived($nostrStore.npub);
  let userPubkey = $derived($nostrStore.pubkey);
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let isOwner = $derived(npub === currentUserNpub);

  // Social graph for known followers (like YouTube subscriber count)
  let graphVersion = $derived($socialGraphStore.version);
  let knownFollowers = $derived.by(() => {
    graphVersion; // Subscribe to changes
    return ownerPubkey ? getFollowers(ownerPubkey) : new Set();
  });

  // Get root CID from treeRootStore (handles linkKey decryption)
  let rootCid = $derived($treeRootStore);

  // Subscribe to trees store to get visibility
  $effect(() => {
    const currentNpub = npub;
    const currentTreeName = treeName;
    if (!currentNpub || !currentTreeName) return;

    const store = createTreesStore(currentNpub);
    const unsub = store.subscribe(trees => {
      const tree = trees.find(t => t.name === currentTreeName);
      if (tree?.visibility) {
        untrack(() => {
          videoVisibility = tree.visibility as TreeVisibility;
        });
      }
    });
    return unsub;
  });

  // Load video when rootCid changes
  $effect(() => {
    const cid = rootCid;
    if (cid) {
      untrack(() => loadVideo(cid));
    }
  });

  // No blob URL cleanup needed - using SW URLs

  async function loadVideo(rootCidParam: CID) {
    if (!npub || !treeName) return;

    error = null;

    const tree = getTree();

    // Try common video filenames immediately (don't wait for directory listing)
    const commonNames = ['video.webm', 'video.mp4', 'video.mov'];
    for (const name of commonNames) {
      try {
        const result = await tree.resolvePath(rootCidParam, name);
        if (result) {
          videoCid = result.cid;
          videoFileName = name;
          videoSrc = getNpubFileUrl(npub, treeName, name);
          loading = false;
          break;
        }
      } catch {}
    }

    // If common names didn't work, list directory to find video
    if (!videoSrc) {
      try {
        const dir = await tree.listDirectory(rootCidParam);
        const videoEntry = dir?.find(e =>
          e.name.startsWith('video.') ||
          e.name.endsWith('.webm') ||
          e.name.endsWith('.mp4') ||
          e.name.endsWith('.mov')
        );

        if (videoEntry) {
          const videoResult = await tree.resolvePath(rootCidParam, videoEntry.name);
          if (videoResult) {
            videoCid = videoResult.cid;
            videoFileName = videoEntry.name;
            videoSrc = getNpubFileUrl(npub, treeName, videoEntry.name);
            loading = false;
          }
        }
      } catch {}
    }

    if (!videoSrc) {
      error = 'Video file not found';
      loading = false;
      return;
    }

    // Load metadata in background (don't block video playback)
    loadMetadata(rootCidParam, tree);

    // Add to recents
    if (npub && treeName) {
      addRecent({
        type: 'tree',
        path: `/${npub}/${treeName}`,
        label: videoTitle || videoName || 'Video',
        npub,
        treeName,
        visibility: videoVisibility,
      });
    }
  }

  /** Load title and description in background */
  async function loadMetadata(rootCid: CID, tree: ReturnType<typeof getTree>) {
    // Load title.txt
    try {
      const titleResult = await tree.resolvePath(rootCid, 'title.txt');
      if (titleResult) {
        const titleData = await tree.readFile(titleResult.cid);
        if (titleData) {
          videoTitle = new TextDecoder().decode(titleData);
        }
      }
    } catch {}

    // Load description.txt
    try {
      const descResult = await tree.resolvePath(rootCid, 'description.txt');
      if (descResult) {
        const descData = await tree.readFile(descResult.cid);
        if (descData) {
          videoDescription = new TextDecoder().decode(descData);
        }
      }
    } catch {}
  }

  function handleShare() {
    const url = window.location.href;
    openShareModal(url);
  }

  function handlePermalink() {
    if (!rootCid) return;
    const nhash = nhashEncode({
      hash: toHex(rootCid.hash),
      decryptKey: rootCid.key ? toHex(rootCid.key) : undefined,
    });
    const url = `${window.location.origin}${window.location.pathname}#/${nhash}`;
    openShareModal(url);
  }

  function handleDownload() {
    if (!videoCid || !videoFileName) return;
    // Navigate to SW URL with ?download=1 query param
    // SW will serve with Content-Disposition: attachment header for streaming download
    const swUrl = getNhashFileUrl(videoCid, videoFileName) + '?download=1';
    window.location.href = swUrl;
  }

  function handleBlossomPush() {
    if (!rootCid) return;
    openBlossomPushModal(rootCid, title, true);
  }

  async function handleDelete() {
    if (!treeName || deleting) return;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    deleting = true;
    try {
      await deleteTree(treeName);
      window.location.hash = '#/';
    } catch (e) {
      console.error('Failed to delete video:', e);
      alert('Failed to delete video');
      deleting = false;
    }
  }

  function startEdit() {
    editTitle = videoTitle || videoName || '';
    editDescription = videoDescription || '';
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    editTitle = '';
    editDescription = '';
  }

  async function saveEdit() {
    if (!npub || !treeName || saving) return;
    if (!editTitle.trim()) {
      alert('Title is required');
      return;
    }

    saving = true;
    try {
      let currentRootCid = rootCid;
      if (!currentRootCid) throw new Error('Video not found');

      const tree = getTree();
      const isPublic = videoVisibility === 'public';

      // Update title.txt
      const titleData = new TextEncoder().encode(editTitle.trim());
      const titleResult = await tree.putFile(titleData, { public: isPublic });
      currentRootCid = await tree.setEntry(currentRootCid, [], 'title.txt', titleResult.cid, titleResult.size, 0 as LinkType);

      // Update description.txt (or remove if empty)
      if (editDescription.trim()) {
        const descData = new TextEncoder().encode(editDescription.trim());
        const descResult = await tree.putFile(descData, { public: isPublic });
        currentRootCid = await tree.setEntry(currentRootCid, [], 'description.txt', descResult.cid, descResult.size, 0 as LinkType);
      } else {
        // Remove description if it exists and is now empty
        try {
          currentRootCid = await tree.removeEntry(currentRootCid, [], 'description.txt');
        } catch {}
      }

      // Save and publish
      updateLocalRootCacheHex(
        npub,
        treeName,
        toHex(currentRootCid.hash),
        currentRootCid.key ? toHex(currentRootCid.key) : undefined,
        videoVisibility
      );

      // Update local state
      videoTitle = editTitle.trim();
      videoDescription = editDescription.trim();
      editing = false;
    } catch (e) {
      console.error('Failed to save:', e);
      alert('Failed to save changes');
    } finally {
      saving = false;
    }
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Video identifier for reactions (npub/treeName format)
  let videoIdentifier = $derived(npub && treeName ? `${npub}/${treeName}` : null);

  // Subscribe to likes for this video
  $effect(() => {
    const identifier = videoIdentifier;
    const currentUserPubkey = userPubkey; // Capture for callback
    if (!identifier) return;

    // Reset state
    untrack(() => {
      likes = new Set();
      userLiked = false;
    });

    // Subscribe to kind 17 reactions with our identifier
    const filter: NDKFilter = {
      kinds: [17 as number],
      '#i': [identifier],
    };

    const sub = ndk.subscribe(filter, { closeOnEose: false });

    sub.on('event', (event: NDKEvent) => {
      if (!event.pubkey) return;

      // Check if it's a like (+ or empty content)
      const content = event.content?.trim() || '+';
      if (content === '+' || content === '') {
        untrack(() => {
          likes = new Set([...likes, event.pubkey]);

          // Check if current user liked
          if (event.pubkey === currentUserPubkey) {
            userLiked = true;
          }
        });
      }
    });

    return () => {
      sub.stop();
    };
  });

  // Toggle like
  async function toggleLike() {
    if (!videoIdentifier || !isLoggedIn || liking) return;

    liking = true;
    try {
      const event = new NDKEvent(ndk);
      event.kind = 17; // External content reaction
      event.content = userLiked ? '' : '+'; // Toggle (note: can't really "unlike" in Nostr, but we track locally)

      // Build tags - include both npub path and nhash for discoverability
      const tags: string[][] = [
        ['i', videoIdentifier, `https://video.iris.to/#/${videoIdentifier}`],
        ['k', 'web'],
      ];

      // Add nhash identifier if we have the root CID (for permalink reactions)
      if (rootCid) {
        const nhash = `nhash/${toHex(rootCid.hash)}`;
        tags.push(['i', nhash, `https://video.iris.to/#/${nhash}`]);
      }

      // Add p tag if we know the owner
      if (ownerPubkey) {
        tags.push(['p', ownerPubkey]);
      }

      event.tags = tags;

      await event.sign();
      await event.publish();

      // Update local state optimistically
      if (!userLiked) {
        likes = new Set([...likes, userPubkey!]);
        userLiked = true;
      }
    } catch (e) {
      console.error('Failed to like video:', e);
    } finally {
      liking = false;
    }
  }
</script>

<div class="flex-1 overflow-auto">
  <!-- Video Player - full width, sensible height like YouTube -->
  <div class="w-full max-w-full bg-black overflow-hidden mx-auto" style="height: min(calc(100vh - 48px - 180px), 80vh); aspect-ratio: 16/9;">
    {#if loading}
      <div class="w-full h-full flex items-center justify-center text-white text-sm">
        Loading video...
      </div>
    {:else if error}
      <div class="w-full h-full flex items-center justify-center text-red-400">
        <span class="i-lucide-alert-circle mr-2"></span>
        {error}
      </div>
    {:else if videoSrc}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        src={videoSrc}
        controls
        autoplay
        playsinline
        class="w-full h-full"
        preload="metadata"
      >
        Your browser does not support the video tag.
      </video>
    {/if}
  </div>

  <!-- Content below video -->
  <div class="max-w-5xl mx-auto px-4 py-4">
    <!-- Video Info -->
    <div class="mb-6">
      {#if editing}
        <!-- Edit form -->
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-text-2 mb-1">Title</label>
            <input
              type="text"
              bind:value={editTitle}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
              placeholder="Video title"
              disabled={saving}
            />
          </div>
          <div>
            <label class="block text-sm text-text-2 mb-1">Description</label>
            <textarea
              bind:value={editDescription}
              class="w-full bg-surface-0 border border-surface-3 rounded-lg p-3 text-text-1 resize-none focus:border-accent focus:outline-none"
              placeholder="Video description..."
              rows="3"
              disabled={saving}
            ></textarea>
          </div>
          <div class="flex gap-2">
            <button onclick={saveEdit} class="btn-primary px-4 py-2" disabled={saving || !editTitle.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onclick={cancelEdit} class="btn-ghost px-4 py-2" disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="flex items-start justify-between gap-4 mb-3">
          <h1 class="text-xl font-semibold text-text-1 break-words min-w-0">{title}</h1>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end">
            <!-- Like button -->
            {#if videoIdentifier}
              <button
                onclick={toggleLike}
                class="btn-ghost p-2 flex items-center gap-1"
                class:text-accent={userLiked}
                title={userLiked ? 'Liked' : 'Like'}
                disabled={!isLoggedIn || liking}
              >
                <span class={userLiked ? 'i-lucide-heart text-lg' : 'i-lucide-heart text-lg'} class:fill-current={userLiked}></span>
                {#if likes.size > 0}
                  <span class="text-sm">{likes.size}</span>
                {/if}
              </button>
            {/if}
            <button onclick={handleShare} class="btn-ghost p-2" title="Share">
              <span class="i-lucide-share text-lg"></span>
            </button>
            <button onclick={handlePermalink} class="btn-ghost p-2" title="Permalink (content-addressed)" disabled={!rootCid}>
              <span class="i-lucide-link text-lg"></span>
            </button>
            <button onclick={handleDownload} class="btn-ghost p-2" title="Download" disabled={!videoCid}>
              <span class="i-lucide-download text-lg"></span>
            </button>
            {#if isOwner}
              <button onclick={handleBlossomPush} class="btn-ghost p-2" title="Push to file servers">
                <span class="i-lucide-upload-cloud text-lg"></span>
              </button>
              <button onclick={startEdit} class="btn-ghost p-2" title="Edit">
                <span class="i-lucide-pencil text-lg"></span>
              </button>
              <button
                onclick={handleDelete}
                class="btn-ghost p-2 text-red-400 hover:text-red-300"
                title="Delete video"
                disabled={deleting}
              >
                <span class={deleting ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'} class:text-lg={true}></span>
              </button>
            {/if}
          </div>
        </div>

        <!-- Owner info -->
        <div class="flex items-center gap-3 mb-4">
          {#if ownerPubkey}
            <a href={`#/${npub}`} class="shrink-0">
              <Avatar pubkey={ownerPubkey} size={40} />
            </a>
            <div class="min-w-0">
              <a href={`#/${npub}`} class="text-text-1 font-medium hover:text-accent no-underline">
                <Name pubkey={ownerPubkey} />
              </a>
              <div class="flex items-center gap-2 text-sm text-text-3">
                <span>{knownFollowers.size} known follower{knownFollowers.size !== 1 ? 's' : ''}</span>
                <span>·</span>
                <VisibilityIcon visibility={videoVisibility} class="text-xs" />
              </div>
            </div>
          {/if}
        </div>

        <!-- Description -->
        {#if videoDescription}
          <div class="bg-surface-1 rounded-lg p-4 text-text-2 text-sm">
            <Truncate text={videoDescription} maxLines={4} maxChars={400} />
          </div>
        {/if}
      {/if}
    </div>

    <!-- Comments -->
    {#if npub && treeName}
      <VideoComments {npub} {treeName} />
    {/if}
  </div>
</div>
