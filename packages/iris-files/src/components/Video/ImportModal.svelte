<script lang="ts" module>
  /**
   * ImportModal - Import videos from yt-dlp backup directories
   * Shows installation instructions and allows folder upload
   */
  let show = $state(false);

  export function open() {
    show = true;
  }

  export function close() {
    show = false;
  }
</script>

<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { nostrStore, saveHashtree, signEvent } from '../../nostr';
  import { toHex, videoChunker, cid, BlossomStore } from 'hashtree';
  import type { CID, BlossomSigner } from 'hashtree';
  import { getTree } from '../../store';
  import { storeLinkKey } from '../../stores/trees';
  import { detectYtDlpDirectory, type YtDlpVideo } from '../../utils/ytdlp';
  import { settingsStore, DEFAULT_NETWORK_SETTINGS } from '../../stores/settings';

  let userNpub = $derived($nostrStore.npub);

  // State
  let folderInput: HTMLInputElement | undefined = $state();
  let mode = $state<'instructions' | 'preview' | 'uploading' | 'pushing' | 'done'>('instructions');
  let batchVideos = $state<YtDlpVideo[]>([]);
  let selectedVideoIds = new SvelteSet<string>();
  let channelName = $state('');
  let batchTotalSize = $state(0);
  let visibility = $state<'public' | 'unlisted' | 'private'>('public');
  let sourceUrl = $state('');
  let isValidUrl = $derived(() => {
    const url = sourceUrl.trim();
    if (!url) return true; // Empty is valid (optional field)
    if (/\s/.test(url)) return false; // No whitespace allowed
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      // Hostname must have a dot (real domain) and not be a protocol name
      if (!parsed.hostname || !parsed.hostname.includes('.')) return false;
      return true;
    } catch {
      return false;
    }
  });

  // Upload state
  let uploading = $state(false);
  let progress = $state(0);
  let progressMessage = $state('');
  let abortController = $state<AbortController | null>(null);

  // Blossom push state
  let pushProgress = $state({ current: 0, total: 0 });
  let pushStats = $state({ pushed: 0, skipped: 0, failed: 0 });

  // Done state
  let resultUrl = $state('');
  let blossomPushFailed = $state(false);

  // Derived
  let selectedVideos = $derived(batchVideos.filter(v => selectedVideoIds.has(v.id)));

  // Reset state when modal closes
  $effect(() => {
    if (!show) {
      mode = 'instructions';
      batchVideos = [];
      selectedVideoIds.clear();
      channelName = '';
      batchTotalSize = 0;
      visibility = 'public';
      sourceUrl = '';
      uploading = false;
      progress = 0;
      progressMessage = '';
      abortController = null;
      pushProgress = { current: 0, total: 0 };
      pushStats = { pushed: 0, skipped: 0, failed: 0 };
      resultUrl = '';
      blossomPushFailed = false;
    }
  });

  function toggleVideo(id: string) {
    if (selectedVideoIds.has(id)) {
      selectedVideoIds.delete(id);
    } else {
      selectedVideoIds.add(id);
    }
  }

  function selectAll() {
    selectedVideoIds.clear();
    batchVideos.forEach(v => selectedVideoIds.add(v.id));
  }

  function deselectAll() {
    selectedVideoIds.clear();
  }

  async function handleFolderSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const result = detectYtDlpDirectory(fileArray);

    if (!result.isYtDlpDirectory || result.videos.length === 0) {
      alert('No yt-dlp videos detected in this folder. Make sure the folder contains videos downloaded with yt-dlp using --write-info-json --write-thumbnail flags.');
      return;
    }

    batchVideos = result.videos;
    channelName = result.channelName || '';
    batchTotalSize = result.totalSize;

    // Select all by default
    selectAll();
    mode = 'preview';
  }

  async function handleBatchUpload() {
    if (selectedVideos.length === 0 || !channelName.trim() || !userNpub) return;

    uploading = true;
    mode = 'uploading';
    progress = 0;
    progressMessage = 'Preparing batch upload...';
    abortController = new AbortController();

    try {
      const tree = getTree();
      const treeName = `videos/${channelName.trim()}`;
      const isPublic = visibility === 'public';

      const rootEntries: Array<{ name: string; cid: CID; size: number }> = [];

      for (let i = 0; i < selectedVideos.length; i++) {
        if (abortController.signal.aborted) throw new Error('Cancelled');

        const video = selectedVideos[i];
        const videoProgress = (i / selectedVideos.length) * 100;
        progress = Math.round(videoProgress);
        progressMessage = `Uploading ${i + 1}/${selectedVideos.length}: ${video.title}`;

        const videoEntries: Array<{ name: string; cid: CID; size: number }> = [];

        // Upload video file
        if (video.videoFile) {
          const streamWriter = tree.createStream({ chunker: videoChunker() });
          const chunkSize = 1024 * 1024;
          const file = video.videoFile;

          for (let offset = 0; offset < file.size; offset += chunkSize) {
            if (abortController.signal.aborted) throw new Error('Cancelled');

            const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
            const data = new Uint8Array(await chunk.arrayBuffer());
            await streamWriter.append(data);

            const fileProgress = offset / file.size;
            const overallProgress = ((i + fileProgress * 0.8) / selectedVideos.length) * 100;
            progress = Math.round(overallProgress);
          }

          const result = await streamWriter.finalize();
          const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
          videoEntries.push({
            name: `video.${ext}`,
            cid: cid(result.hash, result.key),
            size: result.size,
          });
        }

        // Upload info.json and extract description
        if (video.infoJson) {
          const data = new Uint8Array(await video.infoJson.arrayBuffer());
          const result = await tree.putFile(data, {});
          videoEntries.push({ name: 'info.json', cid: result.cid, size: result.size });

          try {
            const jsonText = await video.infoJson.text();
            const infoData = JSON.parse(jsonText);
            if (infoData.description && infoData.description.trim()) {
              const descData = new TextEncoder().encode(infoData.description.trim());
              const descResult = await tree.putFile(descData, {});
              videoEntries.push({ name: 'description.txt', cid: descResult.cid, size: descResult.size });
            }
            if (infoData.title && infoData.title.trim()) {
              const titleData = new TextEncoder().encode(infoData.title.trim());
              const titleResult = await tree.putFile(titleData, {});
              videoEntries.push({ name: 'title.txt', cid: titleResult.cid, size: titleResult.size });
            }
          } catch {
            // Ignore JSON parse errors
          }
        }

        // Upload thumbnail
        if (video.thumbnail) {
          const data = new Uint8Array(await video.thumbnail.arrayBuffer());
          const result = await tree.putFile(data, {});
          const ext = video.thumbnail.name.split('.').pop()?.toLowerCase() || 'jpg';
          videoEntries.push({ name: `thumbnail.${ext}`, cid: result.cid, size: result.size });
        }

        // Create video directory
        const videoDirResult = await tree.putDirectory(videoEntries, {});

        rootEntries.push({
          name: video.id,
          cid: videoDirResult.cid,
          size: videoEntries.reduce((sum, e) => sum + (e.size || 0), 0),
        });
      }

      progress = 95;
      progressMessage = 'Creating channel...';

      const rootDirResult = await tree.putDirectory(rootEntries, {});

      progressMessage = 'Publishing...';
      const rootHash = toHex(rootDirResult.cid.hash);
      const rootKey = rootDirResult.cid.key ? toHex(rootDirResult.cid.key) : undefined;

      const result = await saveHashtree(treeName, rootHash, rootKey, { visibility });
      progress = 100;

      if (result.linkKey && userNpub) {
        storeLinkKey(userNpub, treeName, result.linkKey);
      }

      // Push to blossom servers
      const settings = $settingsStore;
      const blossomServers = settings.network?.blossomServers?.length > 0
        ? settings.network.blossomServers
        : DEFAULT_NETWORK_SETTINGS.blossomServers;
      const writeServers = blossomServers.filter(s => s.write);

      blossomPushFailed = false;
      if (writeServers.length > 0) {
        mode = 'pushing';
        progressMessage = 'Pushing to file servers...';
        pushProgress = { current: 0, total: 0 };
        pushStats = { pushed: 0, skipped: 0, failed: 0 };

        // Create blossom signer
        const signer: BlossomSigner = async (event) => {
          const signed = await signEvent({
            ...event,
            pubkey: '',
            id: '',
            sig: '',
          });
          return signed;
        };

        const blossomStore = new BlossomStore({
          servers: writeServers.map(s => ({ url: s.url, write: true })),
          signer,
        });

        try {
          const pushResult = await tree.push(rootDirResult.cid, blossomStore, {
            signal: abortController?.signal,
            onProgress: (current, total) => {
              pushProgress = { current, total };
            },
          });

          pushStats = {
            pushed: pushResult.pushed,
            skipped: pushResult.skipped,
            failed: pushResult.failed,
          };

          if (pushResult.cancelled) {
            throw new Error('Cancelled');
          }

          // Check if any blocks failed
          if (pushResult.failed > 0) {
            blossomPushFailed = true;
          }
        } catch (pushError) {
          console.error('Blossom push failed:', pushError);
          const msg = pushError instanceof Error ? pushError.message : 'Unknown error';
          if (msg === 'Cancelled') {
            throw pushError; // Re-throw cancellation
          }
          blossomPushFailed = true;
        }
      }

      uploading = false;
      progressMessage = '';
      const encodedTreeName = encodeURIComponent(treeName);
      resultUrl = result.linkKey ? `#/${userNpub}/${encodedTreeName}?k=${result.linkKey}` : `#/${userNpub}/${encodedTreeName}`;

      if (blossomPushFailed) {
        mode = 'done';
      } else {
        window.location.hash = resultUrl;
        close();
      }
    } catch (e) {
      console.error('Batch upload failed:', e);
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message !== 'Cancelled') {
        alert('Failed to upload videos: ' + message);
      }
      uploading = false;
      mode = 'preview';
      progressMessage = '';
      abortController = null;
    }
  }

  function handleCancel() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    uploading = false;
    mode = 'preview';
    progressMessage = '';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  let ytdlpCommand = $derived(
    `yt-dlp ${sourceUrl.trim() || 'URL'} -P backup --write-info-json --write-thumbnail --format mp4`
  );

  let copied = $state(false);
  function copyCommand() {
    navigator.clipboard.writeText(ytdlpCommand);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => !uploading && close()}>
    <div class="bg-surface-1 rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-auto" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="p-4 border-b border-surface-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <span class="i-lucide-folder-down text-accent"></span>
          Import Videos
        </h2>
        <button onclick={() => !uploading && close()} class="btn-ghost p-1" disabled={uploading} title="Close">
          <span class="i-lucide-x text-lg"></span>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        {#if mode === 'instructions'}
          <!-- Installation instructions -->
          <div class="space-y-4">
            <div class="bg-surface-2 rounded-lg p-4">
              <h3 class="font-medium text-text-1 mb-2 flex items-center gap-2">
                <span class="i-lucide-hard-drive-download"></span>
                Backup Your Videos
              </h3>
              <p class="text-text-2 text-sm mb-3">
                Use <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener" class="text-accent hover:underline">yt-dlp</a> to backup videos from YouTube, Vimeo, TikTok, Twitter/X, Twitch, Instagram and <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" target="_blank" rel="noopener" class="text-accent hover:underline">thousands of other sites</a>.
              </p>

              <div class="space-y-3">
                <div>
                  <p class="text-xs text-text-3 mb-1">1. <a href="https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#installation" target="_blank" rel="noopener" class="text-accent hover:underline">Install yt-dlp</a> (or use <a href="https://ytdlp.online/" target="_blank" rel="noopener" class="text-accent hover:underline">web version</a>)</p>
                </div>

                <div>
                  <p class="text-xs text-text-3 mb-1">2. Download videos (optional: paste URL below)</p>
                  <input
                    type="text"
                    bind:value={sourceUrl}
                    class="w-full bg-surface-0 border rounded-lg p-2 text-text-1 text-sm font-mono focus:outline-none mb-2 {isValidUrl() ? 'border-surface-3 focus:border-accent' : 'border-red-500'}"
                    placeholder="https://www.youtube.com/watch?v=... or @channel or playlist"
                  />
                  <div class="relative">
                    <code class="block bg-surface-0 rounded p-2 pr-10 text-sm text-text-1 font-mono break-all">
                      {ytdlpCommand}
                    </code>
                    <button
                      onclick={copyCommand}
                      class="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost p-1"
                      title={copied ? 'Copied!' : 'Copy command'}
                    >
                      <span class={copied ? 'i-lucide-check text-sm text-green-500' : 'i-lucide-copy text-sm'}></span>
                    </button>
                  </div>
                </div>

                <div>
                  <p class="text-xs text-text-3 mb-1">3. Select the "backup" folder below</p>
                </div>
              </div>
            </div>

            <div class="text-center">
              <input
                bind:this={folderInput}
                type="file"
                webkitdirectory
                class="hidden"
                onchange={handleFolderSelect}
              />
              <button
                onclick={() => folderInput?.click()}
                class="btn-primary px-6 py-3 flex items-center gap-2 mx-auto"
              >
                <span class="i-lucide-folder-open"></span>
                Select Folder
              </button>
              <p class="text-text-3 text-xs mt-2">Choose the folder containing your yt-dlp backup</p>
            </div>
          </div>

        {:else if mode === 'preview'}
          <!-- Batch preview -->
          <div class="space-y-4">
            <div class="bg-surface-2 rounded-lg p-4">
              <div class="flex items-center gap-3 mb-3">
                <span class="i-lucide-folder-video text-2xl text-accent"></span>
                <div>
                  <p class="text-text-1 font-medium">yt-dlp Backup Detected</p>
                  <p class="text-text-3 text-sm">{batchVideos.length} videos, {formatSize(batchTotalSize)} total</p>
                </div>
              </div>

              <!-- Channel name input -->
              <div class="mb-3">
                <label class="block text-sm text-text-2 mb-1">Channel Name</label>
                <input
                  type="text"
                  bind:value={channelName}
                  class="w-full bg-surface-0 border border-surface-3 rounded-lg p-2 text-text-1 focus:border-accent focus:outline-none"
                  placeholder="Channel name"
                />
              </div>

              <!-- Video list -->
              <div class="max-h-60 overflow-auto border border-surface-3 rounded-lg">
                <div class="flex items-center justify-between p-2 bg-surface-3 border-b border-surface-3 sticky top-0">
                  <span class="text-sm text-text-2">{selectedVideoIds.size} of {batchVideos.length} selected</span>
                  <div class="flex gap-2">
                    <button onclick={selectAll} class="text-xs text-accent hover:underline">Select all</button>
                    <button onclick={deselectAll} class="text-xs text-text-3 hover:underline">Deselect all</button>
                  </div>
                </div>
                {#each batchVideos as video (video.id)}
                  <button
                    onclick={() => toggleVideo(video.id)}
                    class="w-full flex items-center gap-3 p-2 hover:bg-surface-2 transition-colors text-left border-b border-surface-3 last:border-b-0"
                  >
                    <div class="w-5 h-5 flex items-center justify-center shrink-0">
                      {#if selectedVideoIds.has(video.id)}
                        <span class="i-lucide-check-square text-accent"></span>
                      {:else}
                        <span class="i-lucide-square text-text-3"></span>
                      {/if}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-text-1 text-sm truncate">{video.title}</p>
                      <p class="text-xs text-text-3">
                        {video.videoFile ? formatSize(video.videoFile.size) : 'No video'}
                      </p>
                    </div>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Visibility -->
            <div>
              <label class="block text-sm text-text-2 mb-2">Visibility</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={() => visibility = 'public'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'public' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                >
                  <span class="i-lucide-globe"></span>
                  <span class="text-sm">Public</span>
                </button>
                <button
                  type="button"
                  onclick={() => visibility = 'unlisted'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'unlisted' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                >
                  <span class="i-lucide-link"></span>
                  <span class="text-sm">Unlisted</span>
                </button>
                <button
                  type="button"
                  onclick={() => visibility = 'private'}
                  class="flex-1 flex items-center justify-center gap-2 py-2 px-3 btn-ghost {visibility === 'private' ? 'ring-2 ring-accent bg-surface-3' : ''}"
                >
                  <span class="i-lucide-lock"></span>
                  <span class="text-sm">Private</span>
                </button>
              </div>
            </div>
          </div>

        {:else if mode === 'uploading'}
          <!-- Upload progress -->
          <div class="space-y-4 py-8">
            <div class="text-center">
              <span class="i-lucide-loader-2 text-4xl text-accent animate-spin block mx-auto mb-4"></span>
              <p class="text-text-1 font-medium">{progressMessage}</p>
              <p class="text-text-3 text-sm mt-1">{progress}% complete</p>
            </div>
            <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                class="h-full bg-accent transition-all duration-300"
                style="width: {progress}%"
              ></div>
            </div>
          </div>

        {:else if mode === 'pushing'}
          <!-- Blossom push progress -->
          <div class="space-y-4 py-8">
            <div class="text-center">
              <span class="i-lucide-upload-cloud text-4xl text-accent animate-pulse block mx-auto mb-4"></span>
              <p class="text-text-1 font-medium">Pushing to file servers...</p>
              <p class="text-text-3 text-sm mt-1">
                {pushProgress.current} / {pushProgress.total} chunks
              </p>
            </div>
            <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                class="h-full bg-accent transition-all duration-300"
                style="width: {pushProgress.total > 0 ? (pushProgress.current / pushProgress.total * 100) : 0}%"
              ></div>
            </div>
            {#if pushStats.pushed > 0 || pushStats.skipped > 0}
              <div class="text-center text-xs text-text-3">
                {pushStats.pushed} uploaded, {pushStats.skipped} already exist
              </div>
            {/if}
          </div>

        {:else if mode === 'done'}
          <!-- Done with warning -->
          <div class="space-y-4 py-8">
            <div class="text-center">
              <span class="i-lucide-check-circle text-4xl text-green-500 block mx-auto mb-4"></span>
              <p class="text-text-1 font-medium">Videos saved locally!</p>
            </div>
            {#if blossomPushFailed}
              <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-center">
                <p class="text-yellow-400 text-sm">
                  File server push had issues. You can retry later using the <span class="i-lucide-cloud inline-block align-middle"></span> button in folder actions.
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="p-4 border-t border-surface-3 flex justify-end gap-2">
        {#if mode === 'instructions'}
          <button onclick={close} class="btn-ghost px-4 py-2">
            Close
          </button>
        {:else if mode === 'preview'}
          <button onclick={() => mode = 'instructions'} class="btn-ghost px-4 py-2">
            Back
          </button>
          <button
            onclick={handleBatchUpload}
            class="btn-primary px-4 py-2"
            disabled={!channelName.trim() || selectedVideos.length === 0}
          >
            Upload {selectedVideos.length} Video{selectedVideos.length !== 1 ? 's' : ''}
          </button>
        {:else if mode === 'uploading'}
          <button onclick={handleCancel} class="btn-ghost px-4 py-2">
            Cancel
          </button>
        {:else if mode === 'pushing'}
          <button onclick={handleCancel} class="btn-ghost px-4 py-2">
            Cancel
          </button>
        {:else if mode === 'done'}
          <button onclick={() => { window.location.hash = resultUrl; close(); }} class="btn-primary px-4 py-2">
            View Videos
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
