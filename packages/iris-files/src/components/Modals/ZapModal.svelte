<script lang="ts" module>
  /**
   * ZapModal - NIP-57 zap request modal
   * Shows QR code + copiable invoice for lightning payments
   * Since we don't have a wallet, user must pay manually
   */
  let show = $state(false);
  let targetPubkey = $state<string | null>(null);
  let videoIdentifier = $state<string | null>(null);  // For video zaps

  export function open(pubkey: string, identifier?: string) {
    targetPubkey = pubkey;
    videoIdentifier = identifier || null;
    show = true;
  }

  export function close() {
    show = false;
    targetPubkey = null;
    videoIdentifier = null;
  }
</script>

<script lang="ts">
  import { bech32 } from '@scure/base';
  import QRCode from 'qrcode';
  import { ndk, nostrStore } from '../../nostr';
  import { createProfileStore } from '../../stores/profile';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CopyText from '../CopyText.svelte';

  // Decode LNURL (bech32 encoded URL)
  function decodeLnurl(lnurl: string): string | null {
    try {
      const decoded = bech32.decodeToBytes(lnurl.toLowerCase());
      return new TextDecoder().decode(decoded.bytes);
    } catch {
      return null;
    }
  }

  // Zap amounts in sats
  const ZAP_AMOUNTS = [21, 100, 500, 1000, 5000, 10000];

  let selectedAmount = $state(100);
  let customAmount = $state('');
  let comment = $state('');
  let invoice = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let qrDataUrl = $state<string | null>(null);
  let lnurlData = $state<LnurlPayResponse | null>(null);

  // Profile of target user
  let profileStore = $derived(targetPubkey ? createProfileStore(targetPubkey) : null);
  let profile = $derived(profileStore ? $profileStore : null);

  // Current user
  let isLoggedIn = $derived($nostrStore.isLoggedIn);
  let userPubkey = $derived($nostrStore.pubkey);

  interface LnurlPayResponse {
    callback: string;
    minSendable: number;  // millisats
    maxSendable: number;  // millisats
    metadata: string;
    allowsNostr?: boolean;
    nostrPubkey?: string;
    commentAllowed?: number;
  }

  // Reset state when modal opens
  $effect(() => {
    if (show) {
      invoice = null;
      error = null;
      qrDataUrl = null;
      lnurlData = null;
      selectedAmount = 100;
      customAmount = '';
      comment = '';
      // Fetch LNURL data when modal opens
      const lnAddress = profile?.lud16 || profile?.lud06;
      if (lnAddress) {
        fetchLnurlData(lnAddress);
      }
    }
  });

  // Re-fetch when profile loads
  $effect(() => {
    const lnAddress = profile?.lud16 || profile?.lud06;
    if (show && lnAddress && !lnurlData && !loading) {
      fetchLnurlData(lnAddress);
    }
  });

  // Handle Escape key to close modal
  $effect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement)?.blur();
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  async function fetchLnurlData(lnAddress: string) {
    loading = true;
    error = null;

    try {
      let url: string;

      // Check if it's lud06 (LNURL - starts with lnurl) or lud16 (lightning address - contains @)
      if (lnAddress.toLowerCase().startsWith('lnurl')) {
        // Decode bech32 LNURL
        const decoded = decodeLnurl(lnAddress);
        if (!decoded) {
          throw new Error('Invalid LNURL');
        }
        url = decoded;
      } else if (lnAddress.includes('@')) {
        // Parse lud16 (lightning address) to LNURL endpoint
        // format: user@domain.com -> https://domain.com/.well-known/lnurlp/user
        const [user, domain] = lnAddress.split('@');
        if (!user || !domain) {
          throw new Error('Invalid lightning address');
        }
        url = `https://${domain}/.well-known/lnurlp/${user}`;
      } else {
        throw new Error('Invalid lightning address format');
      }
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch LNURL: ${response.status}`);
      }

      const data = await response.json() as LnurlPayResponse;
      lnurlData = data;

      // Check if it supports Nostr zaps
      if (!data.allowsNostr) {
        console.log('[ZapModal] LNURL does not explicitly support Nostr zaps, will try anyway');
      }
    } catch (e) {
      console.error('[ZapModal] Failed to fetch LNURL:', e);
      error = e instanceof Error ? e.message : 'Failed to fetch lightning address';
    } finally {
      loading = false;
    }
  }

  async function requestInvoice() {
    if (!lnurlData || !targetPubkey) return;

    const amount = customAmount ? parseInt(customAmount, 10) : selectedAmount;
    if (!amount || amount <= 0) {
      error = 'Please enter a valid amount';
      return;
    }

    const amountMsat = amount * 1000;

    // Check limits
    if (amountMsat < lnurlData.minSendable) {
      error = `Minimum amount: ${Math.ceil(lnurlData.minSendable / 1000)} sats`;
      return;
    }
    if (amountMsat > lnurlData.maxSendable) {
      error = `Maximum amount: ${Math.floor(lnurlData.maxSendable / 1000)} sats`;
      return;
    }

    loading = true;
    error = null;

    try {
      // Build callback URL
      const callbackUrl = new URL(lnurlData.callback);
      callbackUrl.searchParams.set('amount', amountMsat.toString());

      // Add zap request if we're logged in and LNURL supports nostr
      if (isLoggedIn && userPubkey) {
        const zapRequest = await createZapRequest(amount);
        if (zapRequest) {
          callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest));
        }
      }

      // Add comment if allowed
      if (comment && lnurlData.commentAllowed && comment.length <= lnurlData.commentAllowed) {
        callbackUrl.searchParams.set('comment', comment);
      }

      const response = await fetch(callbackUrl.toString());
      if (!response.ok) {
        throw new Error(`Failed to get invoice: ${response.status}`);
      }

      const data = await response.json();
      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Failed to get invoice');
      }

      if (!data.pr) {
        throw new Error('No invoice returned');
      }

      const pr = data.pr as string;
      invoice = pr;

      // Generate QR code
      qrDataUrl = await QRCode.toDataURL(pr.toUpperCase(), {
        width: 280,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (e) {
      console.error('[ZapModal] Failed to get invoice:', e);
      error = e instanceof Error ? e.message : 'Failed to get invoice';
    } finally {
      loading = false;
    }
  }

  async function createZapRequest(amountSats: number): Promise<object | null> {
    if (!targetPubkey || !userPubkey) return null;

    try {
      const event = new NDKEvent(ndk);
      event.kind = 9734;  // Zap request
      event.content = comment || '';

      // Build tags
      const tags: string[][] = [
        ['p', targetPubkey],
        ['amount', (amountSats * 1000).toString()],  // millisats
        ['relays', ...ndk.pool.relays.keys()],
      ];

      // Add video identifier if zapping a video
      if (videoIdentifier) {
        tags.push(['i', videoIdentifier]);
        tags.push(['k', 'video']);
      }

      event.tags = tags;

      await event.sign();

      return event.rawEvent();
    } catch (e) {
      console.error('[ZapModal] Failed to create zap request:', e);
      return null;
    }
  }

  function handleAmountSelect(amount: number) {
    selectedAmount = amount;
    customAmount = '';
  }

  function handleCustomAmountChange(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    customAmount = value.replace(/\D/g, '');
  }

  function getDisplayAmount(): number {
    return customAmount ? parseInt(customAmount, 10) || 0 : selectedAmount;
  }
</script>

{#if show && targetPubkey}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/70 flex-center z-1000 overflow-auto"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    data-testid="zap-modal-backdrop"
  >
    <div
      class="bg-surface-1 sm:rounded-lg overflow-auto w-screen sm:w-96 sm:border border-surface-3 max-h-full my-auto"
      data-testid="zap-modal"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-surface-3">
        <h2 class="text-lg font-semibold text-text-1 flex items-center gap-2">
          <span class="i-lucide-zap text-yellow-400"></span>
          Send Zap
        </h2>
        <button onclick={close} class="btn-ghost p-1" title="Close">
          <span class="i-lucide-x text-lg"></span>
        </button>
      </div>

      <div class="p-4">
        {#if !profile?.lud16}
          <!-- No lightning address -->
          <div class="text-center py-8 text-text-3">
            <span class="i-lucide-zap-off text-4xl mb-2 block"></span>
            <p>This user hasn't set up a lightning address</p>
          </div>
        {:else if invoice && qrDataUrl}
          <!-- Invoice display -->
          <div class="text-center">
            <div class="bg-white rounded-lg p-2 mb-4 inline-block">
              <img
                src={qrDataUrl}
                alt="Lightning Invoice QR"
                class="w-70 h-70"
                data-testid="zap-qr-code"
              />
            </div>

            <p class="text-sm text-text-2 mb-2">
              Scan with a lightning wallet or copy the invoice
            </p>

            <div class="bg-surface-2 p-3 rounded mb-4">
              <CopyText text={invoice} truncate={40} class="text-sm" testId="zap-invoice" />
            </div>

            <div class="text-xl font-bold text-yellow-400 mb-4">
              ⚡ {getDisplayAmount().toLocaleString()} sats
            </div>

            <button onclick={() => { invoice = null; qrDataUrl = null; }} class="btn-ghost">
              ← Change amount
            </button>
          </div>
        {:else}
          <!-- Amount selection -->
          <div class="mb-4">
            <label class="block text-sm text-text-2 mb-2">Amount (sats)</label>
            <div class="grid grid-cols-3 gap-2 mb-3">
              {#each ZAP_AMOUNTS as amount (amount)}
                <button
                  onclick={() => handleAmountSelect(amount)}
                  class="py-2 px-3 rounded-lg text-sm font-medium transition-colors"
                  class:bg-accent={selectedAmount === amount && !customAmount}
                  class:text-white={selectedAmount === amount && !customAmount}
                  class:bg-surface-2={selectedAmount !== amount || customAmount}
                  class:text-text-1={selectedAmount !== amount || customAmount}
                  class:hover:bg-surface-3={selectedAmount !== amount || customAmount}
                  data-testid="zap-amount-{amount}"
                >
                  ⚡ {amount.toLocaleString()}
                </button>
              {/each}
            </div>

            <div class="relative">
              <input
                type="text"
                inputmode="numeric"
                value={customAmount}
                oninput={handleCustomAmountChange}
                placeholder="Custom amount..."
                class="w-full bg-surface-2 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
                data-testid="zap-custom-amount"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 text-sm">sats</span>
            </div>
          </div>

          <!-- Comment -->
          {#if lnurlData?.commentAllowed}
            <div class="mb-4">
              <label class="block text-sm text-text-2 mb-2">
                Comment (optional, max {lnurlData.commentAllowed} chars)
              </label>
              <input
                type="text"
                bind:value={comment}
                maxlength={lnurlData.commentAllowed}
                placeholder="Add a comment..."
                class="w-full bg-surface-2 border border-surface-3 rounded-lg p-3 text-text-1 focus:border-accent focus:outline-none"
                data-testid="zap-comment"
              />
            </div>
          {/if}

          <!-- Error -->
          {#if error}
            <div class="bg-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm" data-testid="zap-error">
              {error}
            </div>
          {/if}

          <!-- Get Invoice button -->
          <button
            onclick={requestInvoice}
            disabled={loading || !lnurlData}
            class="btn-primary w-full py-3 flex items-center justify-center gap-2"
            data-testid="zap-get-invoice"
          >
            {#if loading}
              <span class="i-lucide-loader-2 animate-spin"></span>
              Loading...
            {:else}
              <span class="i-lucide-zap"></span>
              Get Invoice for {getDisplayAmount().toLocaleString()} sats
            {/if}
          </button>

          {#if !isLoggedIn}
            <p class="text-xs text-text-3 mt-2 text-center">
              Sign in to attach your identity to the zap
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
