<script lang="ts">
  /**
   * Truncate - Show more/less for long text content
   * Truncates by line count or character count
   */
  interface Props {
    text: string;
    maxLines?: number;
    maxChars?: number;
    class?: string;
  }

  let { text, maxLines = 3, maxChars = 300, class: className = '' }: Props = $props();

  let expanded = $state(false);

  // Check if text needs truncation
  let lines = $derived(text.split('\n'));
  let needsTruncation = $derived(lines.length > maxLines || text.length > maxChars);

  // Truncated text
  let displayText = $derived.by(() => {
    if (expanded || !needsTruncation) return text;

    // Truncate by lines first
    let truncated = lines.slice(0, maxLines).join('\n');

    // Then by chars if still too long
    if (truncated.length > maxChars) {
      truncated = truncated.slice(0, maxChars);
      // Don't cut in middle of word
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > maxChars * 0.8) {
        truncated = truncated.slice(0, lastSpace);
      }
    }

    return truncated;
  });

  let isTruncated = $derived(!expanded && needsTruncation);
</script>

<div class={className}>
  <p class="whitespace-pre-wrap break-words">{displayText}{#if isTruncated}...{/if}</p>
  {#if needsTruncation}
    <button
      onclick={() => expanded = !expanded}
      class="text-accent hover:underline text-sm mt-1"
    >
      {expanded ? 'Show less' : 'Show more'}
    </button>
  {/if}
</div>
