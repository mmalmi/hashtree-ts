<script lang="ts">
  /**
   * Modal for extracting archive files (ZIP)
   * Shows options to extract to current directory, subdirectory, or keep as ZIP
   */
  import { type ExtractLocation } from '../../stores/modals/store';
  import {
    showExtractModal,
    extractTarget,
    extractLocation,
    closeExtractModal,
    setExtractLocation,
  } from '../../stores/modals/file';
  import { uploadSingleFile, uploadExtractedFiles } from '../../actions/file';
  import { formatBytes } from '../../store';

  let show = $derived($showExtractModal);
  let target = $derived($extractTarget);
  let location = $derived($extractLocation);

  let isProcessing = $state(false);

  // Get archive name without extension for subdirectory suggestion
  // If archive has a common root, use that; otherwise use archive name without extension
  let suggestedSubdir = $derived.by(() => {
    if (!target?.archiveName) return '';
    if (target.commonRoot) return target.commonRoot;
    const name = target.archiveName;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
  });

  // Check if archive already has a common root folder
  let hasCommonRoot = $derived(!!target?.commonRoot);

  // Total size of extracted files
  let totalSize = $derived.by(() => {
    if (!target?.files) return 0;
    return target.files.reduce((sum, f) => sum + f.size, 0);
  });

  async function handleExtract() {
    if (!target || isProcessing) return;
    isProcessing = true;

    // Capture values before closing modal
    const archiveData = target.archiveData;
    const archiveName = target.archiveName;
    // Only add subdirName if:
    // 1. User selected 'subdir' option AND
    // 2. Archive doesn't already have a common root folder
    const subdirName = (location === 'subdir' && !hasCommonRoot) ? suggestedSubdir : undefined;

    // Close modal immediately so user sees progress
    closeExtractModal();

    try {
      // Pass archive data and name - extraction happens inside
      await uploadExtractedFiles(archiveData, archiveName, subdirName);
    } catch (e) {
      console.error('Failed to extract files:', e);
    }
  }

  async function handleKeepAsZip() {
    if (!target?.archiveData || isProcessing) return;
    isProcessing = true;

    try {
      await uploadSingleFile(target.archiveName, target.archiveData);
      closeExtractModal();
    } catch (e) {
      console.error('Failed to upload ZIP:', e);
    } finally {
      isProcessing = false;
    }
  }

  function handleCancel() {
    closeExtractModal();
  }

  function handleLocationChange(loc: ExtractLocation) {
    setExtractLocation(loc);
  }
</script>

{#if show && target}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={handleCancel}>
    <div
      class="bg-surface-1 rounded-lg shadow-lg p-6 w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold mb-2">Extract Archive?</h2>
      <p class="text-text-2 mb-4">
        <span class="font-medium text-text-1">{target.archiveName}</span> contains {target.files.length} file{target.files.length !== 1 ? 's' : ''} ({formatBytes(totalSize)})
      </p>

      <!-- File list preview -->
      <div class="mb-4 max-h-32 overflow-y-auto bg-surface-0 rounded border border-surface-3 p-2">
        <ul class="text-sm text-text-2 space-y-0.5">
          {#each target.files.slice(0, 10) as file (file.name)}
            <li class="flex items-center gap-2">
              <span class="i-lucide-file text-xs shrink-0"></span>
              <span class="truncate flex-1">{file.name}</span>
              <span class="text-text-3 text-xs shrink-0">{formatBytes(file.size)}</span>
            </li>
          {/each}
          {#if target.files.length > 10}
            <li class="text-text-3 text-xs">...and {target.files.length - 10} more</li>
          {/if}
        </ul>
      </div>

      <!-- Location options -->
      <div class="mb-4 space-y-2">
        {#if hasCommonRoot}
          <!-- Archive already has a root folder, show simpler options -->
          <p class="text-sm text-text-2 mb-2">
            Archive contains folder: <span class="font-medium text-text-1">{suggestedSubdir}/</span>
          </p>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="extract-location"
              checked={location === 'current'}
              onchange={() => handleLocationChange('current')}
              class="accent-accent"
            />
            <span class="text-sm">Extract here (creates <span class="font-medium text-text-1">{suggestedSubdir}/</span>)</span>
          </label>
        {:else}
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="extract-location"
              checked={location === 'subdir'}
              onchange={() => handleLocationChange('subdir')}
              class="accent-accent"
            />
            <span class="text-sm">Extract to folder: <span class="font-medium text-text-1">{suggestedSubdir}/</span></span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="extract-location"
              checked={location === 'current'}
              onchange={() => handleLocationChange('current')}
              class="accent-accent"
            />
            <span class="text-sm">Extract to current directory</span>
          </label>
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="flex justify-end gap-2 mt-auto">
        <button onclick={handleCancel} class="btn-ghost" disabled={isProcessing}>
          Cancel
        </button>
        <button onclick={handleKeepAsZip} class="btn-ghost" disabled={isProcessing}>
          Keep as ZIP
        </button>
        <button onclick={handleExtract} class="btn-success" disabled={isProcessing}>
          {isProcessing ? 'Extracting...' : 'Extract Files'}
        </button>
      </div>
    </div>
  </div>
{/if}
