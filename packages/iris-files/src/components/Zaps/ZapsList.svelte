<script lang="ts">
  /**
   * ZapsList - displays zaps with summary and individual items
   * Reusable component for video comments and profile pages
   */
  import { nip19 } from 'nostr-tools';
  import { Avatar, Name } from '../User';
  import type { Zap } from '../../utils/zaps';

  interface Props {
    zaps: Zap[];
    showSummary?: boolean;
    maxItems?: number;
  }

  let { zaps, showSummary = true, maxItems = 50 }: Props = $props();

  let totalSats = $derived(zaps.reduce((sum, z) => sum + z.amountSats, 0));
  let displayZaps = $derived(maxItems ? zaps.slice(0, maxItems) : zaps);

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }
</script>

{#if zaps.length > 0}
  <!-- Summary -->
  {#if showSummary}
    <div class="flex items-center gap-3 mb-4 p-3 bg-surface-1 rounded-lg" data-testid="zaps-summary">
      <span class="i-lucide-zap text-yellow-400 text-xl"></span>
      <div>
        <span class="font-semibold text-yellow-400" data-testid="zaps-total">
          ⚡ {totalSats.toLocaleString()} sats
        </span>
        <span class="text-text-3 text-sm ml-2">
          from {zaps.length} zap{zaps.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  {/if}

  <!-- List -->
  <div class="space-y-3" data-testid="zaps-list">
    {#each displayZaps as zap (zap.id)}
      <div class="flex gap-3 p-3 bg-surface-1 rounded-lg" data-testid="zap-item">
        <a href={`#/${nip19.npubEncode(zap.senderPubkey)}`} class="shrink-0">
          <Avatar pubkey={zap.senderPubkey} size={36} />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <a href={`#/${nip19.npubEncode(zap.senderPubkey)}`} class="font-medium text-text-1 hover:text-accent no-underline">
              <Name pubkey={zap.senderPubkey} />
            </a>
            <span class="text-yellow-400 font-semibold">
              ⚡ {zap.amountSats.toLocaleString()}
            </span>
            <span class="text-xs text-text-3">{formatTime(zap.createdAt)}</span>
          </div>
          {#if zap.comment}
            <p class="text-text-2 text-sm mt-1 whitespace-pre-wrap break-words">{zap.comment}</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
