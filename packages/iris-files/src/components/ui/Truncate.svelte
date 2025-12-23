<script lang="ts">
  /**
   * Truncate - Show more/less for long text content
   * Truncates by line count or character count
   * Automatically highlights URLs as clickable links
   */
  interface Props {
    text: string;
    maxLines?: number;
    maxChars?: number;
    class?: string;
    highlightLinks?: boolean;
  }

  let { text, maxLines = 3, maxChars = 300, class: className = '', highlightLinks = true }: Props = $props();

  // URL regex - matches http(s) URLs
  const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

  /** Convert URLs in text to clickable links */
  function linkify(input: string): string {
    if (!highlightLinks) return escapeHtml(input);

    // Escape HTML first, then replace URLs
    const escaped = escapeHtml(input);
    return escaped.replace(URL_REGEX, (url) => {
      // Clean up trailing punctuation that's likely not part of URL
      let cleanUrl = url;
      const trailingPunct = /[.,;:!?)]+$/;
      const match = cleanUrl.match(trailingPunct);
      let suffix = '';
      if (match) {
        suffix = match[0];
        cleanUrl = cleanUrl.slice(0, -suffix.length);
      }
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">${cleanUrl}</a>${suffix}`;
    });
  }

  /** Escape HTML special characters */
  function escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let expanded = $state(false);

  // Check if text needs truncation
  let lines = $derived(text.split('\n'));
  let needsTruncation = $derived(lines.length > maxLines || text.length > maxChars);

  // Show top button when expanded and content is really long
  let showTopButton = $derived(expanded && (lines.length > maxLines * 2 || text.length > maxChars * 2));

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
  {#if showTopButton}
    <button
      onclick={() => expanded = false}
      class="text-accent hover:underline text-sm mb-2"
    >
      Show less
    </button>
  {/if}
  <p class="whitespace-pre-wrap break-words">{@html linkify(displayText)}{#if isTruncated}...{/if}</p>
  {#if needsTruncation}
    <button
      onclick={() => expanded = !expanded}
      class="text-accent hover:underline text-sm mt-1"
    >
      {expanded ? 'Show less' : 'Show more'}
    </button>
  {/if}
</div>
