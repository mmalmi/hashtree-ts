/**
 * Shared protocol utilities for hashtree data exchange
 *
 * Used by both WebRTC (peer.ts) and WebSocket (wsPeer.ts) implementations.
 *
 * Binary message format: [4-byte LE request_id][data]
 * JSON messages: req, res, push, have, want, root
 */
import { sha256 } from '../hash.js';
import { toHex } from '../types.js';
import type { DataRequest, DataResponse, DataMessage } from './types.js';

/**
 * Parse a binary message packet
 * Format: [4-byte little-endian request_id][data]
 */
export function parseBinaryMessage(data: ArrayBuffer): { requestId: number; payload: Uint8Array } {
  const view = new DataView(data);
  const requestId = view.getUint32(0, true); // little-endian
  const payload = new Uint8Array(data, 4);
  return { requestId, payload };
}

/**
 * Create a binary message packet
 * Format: [4-byte little-endian request_id][data]
 */
export function createBinaryMessage(requestId: number, data: Uint8Array): ArrayBuffer {
  const packet = new Uint8Array(4 + data.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, requestId, true); // little-endian
  packet.set(data, 4);
  return packet.buffer;
}

/**
 * Verify that data matches its expected hash
 */
export async function verifyHash(data: Uint8Array, expectedHashHex: string): Promise<boolean> {
  const computedHash = await sha256(data);
  return toHex(computedHash) === expectedHashHex;
}

/**
 * Pending request tracking
 */
export interface PendingRequest<T = Uint8Array | null> {
  hash: string;
  resolve: (data: T) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Create a data request message
 */
export function createRequest(id: number, hashHex: string): DataRequest {
  return { type: 'req', id, hash: hashHex };
}

/**
 * Create a data response message
 */
export function createResponse(id: number, hashHex: string, found: boolean): DataResponse {
  return { type: 'res', id, hash: hashHex, found };
}

/**
 * Parse a JSON message as DataMessage
 * Returns null if parsing fails
 */
export function parseDataMessage(json: string): DataMessage | null {
  try {
    return JSON.parse(json) as DataMessage;
  } catch {
    return null;
  }
}

/**
 * Handle a binary response for a pending request
 * Verifies the hash and resolves the pending request
 */
export async function handleBinaryResponse(
  data: ArrayBuffer,
  pendingRequests: Map<number, PendingRequest>,
  onHashMismatch?: (requestId: number) => void,
): Promise<void> {
  const { requestId, payload } = parseBinaryMessage(data);

  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);

  const isValid = await verifyHash(payload, pending.hash);
  if (isValid) {
    pending.resolve(payload);
  } else {
    onHashMismatch?.(requestId);
    pending.resolve(null);
  }
}

/**
 * Handle a "res" (response) message for pending requests
 * If found=false, resolves the request as null
 * If found=true, the caller should wait for binary data
 */
export function handleResponseMessage(
  msg: DataResponse,
  pendingRequests: Map<number, PendingRequest>,
): void {
  const pending = pendingRequests.get(msg.id);
  if (!pending) return;

  if (!msg.found) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(msg.id);
    pending.resolve(null);
  }
  // If found, caller waits for binary data
}

/**
 * Create a request promise with timeout handling
 */
export function createRequestPromise(
  requestId: number,
  hashHex: string,
  pendingRequests: Map<number, PendingRequest>,
  timeoutMs: number,
  sendFn: (msg: DataRequest) => void,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pendingRequests.set(requestId, { hash: hashHex, resolve, timeout });

    const msg = createRequest(requestId, hashHex);
    sendFn(msg);
  });
}

/**
 * Clear all pending requests (on disconnect/close)
 */
export function clearPendingRequests(pendingRequests: Map<number, PendingRequest>): void {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.resolve(null);
  }
  pendingRequests.clear();
}
