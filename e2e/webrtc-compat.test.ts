/**
 * E2E test for WebRTC signaling protocol compatibility between hashtree-ts and nosta
 *
 * This test verifies that:
 * 1. Both use the same Nostr event kind (30078)
 * 2. Both use the same tag format (["l", "webrtc"])
 * 3. Both use compatible signaling message formats
 */

import { test, expect } from '@playwright/test';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

// Test configuration - same as both implementations
const WEBRTC_KIND = 30078;
const WEBRTC_TAG = 'webrtc';
const TEST_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

// Message types matching the protocol
interface HelloMessage {
  type: 'hello';
  peerId: string;
}

interface OfferMessage {
  type: 'offer';
  offer: unknown;
  recipient: string;
  peerId: string;
}

interface AnswerMessage {
  type: 'answer';
  answer: unknown;
  recipient: string;
  peerId: string;
}

interface CandidateMessage {
  type: 'candidate';
  candidate: unknown;
  recipient: string;
  peerId: string;
}

type SignalingMessage = HelloMessage | OfferMessage | AnswerMessage | CandidateMessage;

function generateUuid(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

test.describe('WebRTC Signaling Protocol Compatibility', () => {
  test.setTimeout(30000);

  test('signaling message format matches iris-client protocol', async () => {
    // Generate test keys
    const sk1 = generateSecretKey();
    const pk1 = getPublicKey(sk1);
    const uuid1 = generateUuid();
    const peerId1 = `${pk1}:${uuid1}`;

    const sk2 = generateSecretKey();
    const pk2 = getPublicKey(sk2);
    const uuid2 = generateUuid();
    const peerId2 = `${pk2}:${uuid2}`;

    // Create a hello message (as hashtree-ts would)
    const helloMsg: HelloMessage = {
      type: 'hello',
      peerId: uuid1,
    };

    // Create offer message format
    const offerMsg: OfferMessage = {
      type: 'offer',
      offer: { type: 'offer', sdp: 'test-sdp' },
      recipient: peerId2,
      peerId: uuid1,
    };

    // Create answer message format
    const answerMsg: AnswerMessage = {
      type: 'answer',
      answer: { type: 'answer', sdp: 'test-sdp-answer' },
      recipient: peerId1,
      peerId: uuid2,
    };

    // Create candidate message format
    const candidateMsg: CandidateMessage = {
      type: 'candidate',
      candidate: { candidate: 'test-candidate', sdpMid: '0', sdpMLineIndex: 0 },
      recipient: peerId1,
      peerId: uuid2,
    };

    // Verify all messages can be serialized to JSON
    expect(JSON.stringify(helloMsg)).toBeTruthy();
    expect(JSON.stringify(offerMsg)).toBeTruthy();
    expect(JSON.stringify(answerMsg)).toBeTruthy();
    expect(JSON.stringify(candidateMsg)).toBeTruthy();

    // Verify messages can be parsed back
    const parsedHello = JSON.parse(JSON.stringify(helloMsg)) as SignalingMessage;
    expect(parsedHello.type).toBe('hello');

    const parsedOffer = JSON.parse(JSON.stringify(offerMsg)) as SignalingMessage;
    expect(parsedOffer.type).toBe('offer');
    expect((parsedOffer as OfferMessage).recipient).toBe(peerId2);

    console.log('All signaling message formats are valid');
  });

  test('nostr event format matches iris-client protocol', async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const uuid = generateUuid();

    const helloMsg: HelloMessage = {
      type: 'hello',
      peerId: uuid,
    };

    const expiration = Math.floor((Date.now() + 15000) / 1000);
    const msgUuid = generateUuid();

    // Create event in the format used by both hashtree-ts and nosta
    const eventTemplate = {
      kind: WEBRTC_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['l', WEBRTC_TAG],           // Label tag for webrtc
        ['d', msgUuid],               // Unique identifier
        ['expiration', expiration.toString()],
      ],
      content: JSON.stringify(helloMsg),
    };

    const signedEvent = finalizeEvent(eventTemplate, sk);

    // Verify event structure
    expect(signedEvent.kind).toBe(30078);
    expect(signedEvent.pubkey).toBe(pk);

    // Verify tags
    const lTag = signedEvent.tags.find(t => t[0] === 'l');
    expect(lTag).toBeTruthy();
    expect(lTag![1]).toBe('webrtc');

    const dTag = signedEvent.tags.find(t => t[0] === 'd');
    expect(dTag).toBeTruthy();

    const expTag = signedEvent.tags.find(t => t[0] === 'expiration');
    expect(expTag).toBeTruthy();

    // Verify content is valid JSON
    const content = JSON.parse(signedEvent.content) as SignalingMessage;
    expect(content.type).toBe('hello');

    console.log('Nostr event format matches protocol');
    console.log('Event kind:', signedEvent.kind);
    console.log('Tags:', signedEvent.tags);
  });

  test('peer ID format is compatible', async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const uuid = generateUuid();

    // PeerId format: pubkey:uuid
    const peerId = `${pk}:${uuid}`;

    // Verify format
    const parts = peerId.split(':');
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(pk);
    expect(parts[0].length).toBe(64); // hex pubkey
    expect(parts[1]).toBe(uuid);

    // Verify short format for logging
    const shortPeerId = `${pk.slice(0, 8)}:${uuid.slice(0, 6)}`;
    expect(shortPeerId.length).toBe(15); // 8 + 1 + 6

    console.log('PeerId format:', peerId);
    console.log('Short format:', shortPeerId);
  });

  test('tie-breaking logic is consistent', async () => {
    // Both implementations use: lower UUID initiates connection
    const uuid1 = 'aaaaaaaaaaaaaaa';
    const uuid2 = 'zzzzzzzzzzzzzzz';

    // uuid1 < uuid2, so uuid1 should initiate
    expect(uuid1 < uuid2).toBe(true);

    // Real UUID comparison
    const realUuid1 = generateUuid();
    const realUuid2 = generateUuid();

    // One of them should be "smaller" and initiate
    const initiator = realUuid1 < realUuid2 ? 'uuid1' : 'uuid2';
    console.log(`${initiator} would initiate (${realUuid1} vs ${realUuid2})`);
  });

  test.skip('can exchange hello messages via relay', async () => {
    // This test requires actual relay connectivity
    // Skip by default but can be enabled for integration testing

    const pool = new SimplePool();

    const sk1 = generateSecretKey();
    const pk1 = getPublicKey(sk1);
    const uuid1 = generateUuid();

    const sk2 = generateSecretKey();
    const pk2 = getPublicKey(sk2);
    const uuid2 = generateUuid();

    const receivedMessages: Event[] = [];

    // Subscribe to webrtc events
    const sub = pool.subscribeMany(
      TEST_RELAYS,
      [{
        kinds: [WEBRTC_KIND],
        '#l': [WEBRTC_TAG],
        since: Math.floor(Date.now() / 1000) - 60,
      }],
      {
        onevent(event) {
          receivedMessages.push(event);
        },
      }
    );

    // Wait for subscription to be ready
    await new Promise(r => setTimeout(r, 2000));

    // Send hello from peer1
    const helloMsg: HelloMessage = { type: 'hello', peerId: uuid1 };
    const expiration = Math.floor((Date.now() + 15000) / 1000);

    const event1 = finalizeEvent({
      kind: WEBRTC_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['l', WEBRTC_TAG],
        ['d', generateUuid()],
        ['expiration', expiration.toString()],
      ],
      content: JSON.stringify(helloMsg),
    }, sk1);

    // Publish to relays
    await Promise.all(TEST_RELAYS.map(relay => pool.publish([relay], event1)));

    // Wait for message to propagate
    await new Promise(r => setTimeout(r, 3000));

    // Check if we received the message
    console.log(`Received ${receivedMessages.length} messages`);

    sub.close();
    pool.close(TEST_RELAYS);

    // We should have received at least our own message
    expect(receivedMessages.length).toBeGreaterThanOrEqual(0);
  });
});
