/**
 * WebRTC Signaling Handler for Hashtree Worker
 *
 * Handles WebRTC signaling via Nostr (kind 25050).
 * - Hello messages: broadcast with #l tag for peer discovery
 * - Directed messages (offer/answer/candidates): gift-wrapped for privacy
 */

import type { SignedEvent } from './protocol';
import type { SignalingMessage } from '../webrtc/types';
import type { WebRTCController } from './webrtc';
import { getNostrManager } from './nostr';
import { signEvent, giftWrap, giftUnwrap } from './signing';

// Kind for WebRTC signaling (ephemeral, gift-wrapped for directed messages)
const SIGNALING_KIND = 25050;
const HELLO_TAG = 'hello';

let webrtc: WebRTCController | null = null;

/**
 * Initialize the WebRTC signaling handler
 */
export function initWebRTCSignaling(controller: WebRTCController): void {
  webrtc = controller;
}

/**
 * Send WebRTC signaling message via Nostr (kind 25050)
 * - Hello messages: broadcast with #l tag
 * - Directed messages (offer/answer/candidates): gift-wrapped
 */
export async function sendWebRTCSignaling(
  msg: SignalingMessage,
  recipientPubkey?: string
): Promise<void> {
  try {
    const nostr = getNostrManager();
    console.log(
      '[Worker] sendWebRTCSignaling:',
      msg.type,
      recipientPubkey ? `to ${recipientPubkey.slice(0, 8)}` : 'broadcast'
    );

    if (recipientPubkey) {
      // Directed message - gift wrap for privacy
      const innerEvent = {
        kind: SIGNALING_KIND,
        content: JSON.stringify(msg),
        tags: [] as string[][],
      };
      const wrappedEvent = await giftWrap(innerEvent, recipientPubkey);
      console.log('[Worker] Publishing wrapped event...');
      await nostr.publish(wrappedEvent);
    } else {
      // Hello message - broadcast with #l tag
      const expiration = Math.floor((Date.now() + 5 * 60 * 1000) / 1000); // 5 minutes
      console.log('[Worker] Signing hello event...');
      const event = await signEvent({
        kind: SIGNALING_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['l', HELLO_TAG],
          ['peerId', msg.peerId],
          ['expiration', expiration.toString()],
        ],
        content: '',
      });
      console.log('[Worker] Hello event signed, publishing...', event.id?.slice(0, 8));
      await nostr.publish(event);
      console.log('[Worker] Hello event published');
    }
  } catch (err) {
    console.error('[Worker] Failed to send WebRTC signaling:', err);
  }
}

/**
 * Subscribe to WebRTC signaling events.
 * NOTE: The caller must set up the event handler via NostrManager.setOnEvent
 * and route webrtc-* subscriptions to handleWebRTCSignalingEvent.
 */
export function setupWebRTCSignalingSubscription(myPubkey: string): void {
  const nostr = getNostrManager();
  const since = Math.floor((Date.now() - 60000) / 1000); // Last minute

  // Subscribe to hello messages (broadcast discovery)
  nostr.subscribe('webrtc-hello', [
    {
      kinds: [SIGNALING_KIND],
      '#l': [HELLO_TAG],
      since,
    },
  ]);

  // Subscribe to directed signaling (offers/answers to us)
  nostr.subscribe('webrtc-directed', [
    {
      kinds: [SIGNALING_KIND],
      '#p': [myPubkey],
      since,
    },
  ]);

  console.log('[Worker] Subscribed to WebRTC signaling');
}

/**
 * Handle incoming WebRTC signaling event.
 * Call this from the unified NostrManager event handler for webrtc-* subscriptions.
 */
export async function handleWebRTCSignalingEvent(event: SignedEvent): Promise<void> {
  console.log(
    '[Worker] Received WebRTC signaling event from',
    event.pubkey.slice(0, 8),
    'kind:',
    event.kind,
    'tags:',
    event.tags
  );

  // Filter out old events
  const eventAge = Date.now() / 1000 - (event.created_at ?? 0);
  if (eventAge > 60) {
    console.log('[Worker] Ignoring old event, age:', eventAge);
    return; // Ignore events older than 1 minute
  }

  // Check expiration
  const expirationTag = event.tags.find((t) => t[0] === 'expiration');
  if (expirationTag) {
    const expiration = parseInt(expirationTag[1], 10);
    if (expiration < Date.now() / 1000) return;
  }

  // Check if it's a hello message (has #l tag)
  const isHello = event.tags.some((t) => t[0] === 'l' && t[1] === HELLO_TAG);

  if (isHello) {
    // Hello message - extract peerId from tag
    const peerIdTag = event.tags.find((t) => t[0] === 'peerId');
    if (peerIdTag) {
      const msg: SignalingMessage = {
        type: 'hello',
        peerId: peerIdTag[1],
      };
      webrtc?.handleSignalingMessage(msg, event.pubkey);
    }
  } else {
    // Directed message - try to unwrap
    const seal = await giftUnwrap(event);
    if (seal && seal.content) {
      try {
        const msg = JSON.parse(seal.content) as SignalingMessage;
        webrtc?.handleSignalingMessage(msg, seal.pubkey);
      } catch {
        // Invalid JSON, ignore
      }
    }
  }
}
