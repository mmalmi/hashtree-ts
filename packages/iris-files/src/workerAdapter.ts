/**
 * Worker Adapter
 *
 * Main thread adapter for communicating with the hashtree worker.
 * Provides a Promise-based API wrapping postMessage communication.
 * Handles worker crash recovery with exponential backoff.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerConfig,
  WorkerNostrFilter as NostrFilter,
  WorkerSignedEvent as SignedEvent,
  WorkerUnsignedEvent as UnsignedEvent,
  WorkerPeerStats as PeerStats,
  WorkerRelayStats as RelayStats,
  WorkerDirEntry as DirEntry,
  CID,
} from 'hashtree';
import { generateRequestId } from 'hashtree';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type SubscriptionCallback = (event: SignedEvent) => void;
type EoseCallback = () => void;

// Worker constructor type - can be either a URL string or a Worker constructor from Vite
type WorkerConstructor = string | (new () => Worker);

export class WorkerAdapter {
  private worker: Worker | null = null;
  private workerFactory: WorkerConstructor;
  private config: WorkerConfig;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private restartAttempts = 0;
  private maxRestartAttempts = 10;

  // Pending requests waiting for responses
  private pendingRequests = new Map<string, PendingRequest>();

  // Nostr subscription callbacks
  private subscriptions = new Map<string, { callback: SubscriptionCallback; eose?: EoseCallback }>();

  // Stream callbacks (for readFileStream)
  private streamCallbacks = new Map<string, (chunk: Uint8Array, done: boolean) => void>();

  // Message queue for messages sent before worker is ready
  private messageQueue: WorkerRequest[] = [];

  /**
   * Create a WorkerAdapter
   * @param workerFactory - Either a URL string or a Worker constructor from Vite's `?worker` import
   * @param config - Worker configuration
   */
  constructor(workerFactory: WorkerConstructor, config: WorkerConfig) {
    this.workerFactory = workerFactory;
    this.config = config;
  }

  /**
   * Initialize the worker and wait for it to be ready
   */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    this.spawnWorker();

    return this.readyPromise;
  }

  private spawnWorker() {
    if (typeof this.workerFactory === 'string') {
      this.worker = new Worker(this.workerFactory, { type: 'module' });
    } else {
      // Vite worker constructor
      this.worker = new this.workerFactory();
    }
    this.setupMessageHandler();
    this.setupErrorHandler();

    // Send init message
    this.worker.postMessage({
      type: 'init',
      id: generateRequestId(),
      config: this.config,
    } as WorkerRequest);
  }

  private setupMessageHandler() {
    if (!this.worker) return;

    this.worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;

      switch (msg.type) {
        case 'ready':
          this.ready = true;
          this.restartAttempts = 0;
          this.flushMessageQueue();
          this.readyResolve?.();
          console.log('[WorkerAdapter] Worker ready');
          break;

        case 'error':
          if (msg.id) {
            this.rejectPending(msg.id, new Error(msg.error));
          } else {
            console.error('[WorkerAdapter] Worker error:', msg.error);
          }
          break;

        case 'result':
        case 'bool':
        case 'cid':
        case 'void':
        case 'dirListing':
        case 'peerStats':
        case 'relayStats':
          this.resolvePending(msg.id, msg);
          break;

        case 'streamChunk':
          this.handleStreamChunk(msg.id, msg.chunk, msg.done);
          break;

        case 'event':
          this.handleNostrEvent(msg.subId, msg.event);
          break;

        case 'eose':
          this.handleEose(msg.subId);
          break;

        // NIP-07 requests from worker - delegate to main thread extension
        case 'signEvent':
          await this.handleSignRequest(msg.id, msg.event);
          break;

        case 'nip44Encrypt':
          await this.handleEncryptRequest(msg.id, msg.pubkey, msg.plaintext);
          break;

        case 'nip44Decrypt':
          await this.handleDecryptRequest(msg.id, msg.pubkey, msg.ciphertext);
          break;

        default:
          console.warn('[WorkerAdapter] Unknown message type:', (msg as { type: string }).type);
      }
    };
  }

  private setupErrorHandler() {
    if (!this.worker) return;

    this.worker.onerror = (error) => {
      console.error('[WorkerAdapter] Worker crashed:', error);
      this.handleWorkerCrash();
    };
  }

  private async handleWorkerCrash() {
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;

    // Reject all pending requests
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Worker crashed'));
    }
    this.pendingRequests.clear();

    // Attempt restart with exponential backoff
    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.restartAttempts - 1), 30000);
      console.log(`[WorkerAdapter] Restarting worker in ${delay}ms (attempt ${this.restartAttempts})`);

      await new Promise((resolve) => setTimeout(resolve, delay));

      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });

      this.spawnWorker();
    } else {
      console.error('[WorkerAdapter] Max restart attempts exceeded');
    }
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      this.worker?.postMessage(msg);
    }
  }

  private postMessage(msg: WorkerRequest, transfer?: Transferable[]) {
    if (this.ready && this.worker) {
      if (transfer) {
        this.worker.postMessage(msg, transfer);
      } else {
        this.worker.postMessage(msg);
      }
    } else {
      this.messageQueue.push(msg);
    }
  }

  private resolvePending(id: string, value: unknown) {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      pending.resolve(value);
    }
  }

  private rejectPending(id: string, error: Error) {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  private request<T>(msg: WorkerRequest, transfer?: Transferable[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = (msg as { id: string }).id;
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.postMessage(msg, transfer);

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  // ============================================================================
  // Stream Handling
  // ============================================================================

  private handleStreamChunk(id: string, chunk: Uint8Array, done: boolean) {
    const callback = this.streamCallbacks.get(id);
    if (callback) {
      callback(chunk, done);
      if (done) {
        this.streamCallbacks.delete(id);
      }
    }
  }

  // ============================================================================
  // Nostr Event Handling
  // ============================================================================

  private handleNostrEvent(subId: string, event: SignedEvent) {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.callback(event);
    }
  }

  private handleEose(subId: string) {
    const sub = this.subscriptions.get(subId);
    if (sub?.eose) {
      sub.eose();
    }
  }

  // ============================================================================
  // NIP-07 Handlers (delegate to window.nostr)
  // ============================================================================

  private async handleSignRequest(id: string, event: UnsignedEvent) {
    try {
      const nostr = (window as unknown as { nostr?: { signEvent: (e: UnsignedEvent) => Promise<SignedEvent> } }).nostr;
      if (!nostr?.signEvent) {
        throw new Error('NIP-07 extension not available');
      }

      const signed = await nostr.signEvent(event);
      this.worker?.postMessage({ type: 'signed', id, event: signed } as WorkerRequest);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.worker?.postMessage({ type: 'signed', id, error } as WorkerRequest);
    }
  }

  private async handleEncryptRequest(id: string, pubkey: string, plaintext: string) {
    try {
      const nostr = (window as unknown as { nostr?: { nip44?: { encrypt: (pk: string, pt: string) => Promise<string> } } }).nostr;
      if (!nostr?.nip44?.encrypt) {
        throw new Error('NIP-44 encryption not available');
      }

      const ciphertext = await nostr.nip44.encrypt(pubkey, plaintext);
      this.worker?.postMessage({ type: 'encrypted', id, ciphertext } as WorkerRequest);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.worker?.postMessage({ type: 'encrypted', id, error } as WorkerRequest);
    }
  }

  private async handleDecryptRequest(id: string, pubkey: string, ciphertext: string) {
    try {
      const nostr = (window as unknown as { nostr?: { nip44?: { decrypt: (pk: string, ct: string) => Promise<string> } } }).nostr;
      if (!nostr?.nip44?.decrypt) {
        throw new Error('NIP-44 decryption not available');
      }

      const plaintext = await nostr.nip44.decrypt(pubkey, ciphertext);
      this.worker?.postMessage({ type: 'decrypted', id, plaintext } as WorkerRequest);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.worker?.postMessage({ type: 'decrypted', id, error } as WorkerRequest);
    }
  }

  // ============================================================================
  // Public API - Store Operations
  // ============================================================================

  async get(hash: Uint8Array): Promise<Uint8Array | null> {
    const id = generateRequestId();
    const response = await this.request<{ data?: Uint8Array; error?: string }>({
      type: 'get',
      id,
      hash,
    });
    if (response.error) throw new Error(response.error);
    return response.data || null;
  }

  async put(hash: Uint8Array, data: Uint8Array): Promise<boolean> {
    const id = generateRequestId();
    const response = await this.request<{ value: boolean; error?: string }>(
      { type: 'put', id, hash, data },
      [data.buffer]  // Transfer ownership
    );
    if (response.error) throw new Error(response.error);
    return response.value;
  }

  async has(hash: Uint8Array): Promise<boolean> {
    const id = generateRequestId();
    const response = await this.request<{ value: boolean; error?: string }>({
      type: 'has',
      id,
      hash,
    });
    if (response.error) throw new Error(response.error);
    return response.value;
  }

  async delete(hash: Uint8Array): Promise<boolean> {
    const id = generateRequestId();
    const response = await this.request<{ value: boolean; error?: string }>({
      type: 'delete',
      id,
      hash,
    });
    if (response.error) throw new Error(response.error);
    return response.value;
  }

  // ============================================================================
  // Public API - Tree Operations
  // ============================================================================

  async readFile(cid: CID): Promise<Uint8Array | null> {
    const id = generateRequestId();
    const response = await this.request<{ data?: Uint8Array; error?: string }>({
      type: 'readFile',
      id,
      cid,
    });
    if (response.error) throw new Error(response.error);
    return response.data || null;
  }

  async readFileRange(cid: CID, start: number, end?: number): Promise<Uint8Array | null> {
    const id = generateRequestId();
    const response = await this.request<{ data?: Uint8Array; error?: string }>({
      type: 'readFileRange',
      id,
      cid,
      start,
      end,
    });
    if (response.error) throw new Error(response.error);
    return response.data || null;
  }

  async *readFileStream(cid: CID): AsyncGenerator<Uint8Array> {
    const id = generateRequestId();
    const chunks: Uint8Array[] = [];
    let done = false;
    let resolveNext: (() => void) | null = null;

    this.streamCallbacks.set(id, (chunk, isDone) => {
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      done = isDone;
      resolveNext?.();
    });

    this.postMessage({ type: 'readFileStream', id, cid });

    while (!done) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }

    // Yield any remaining chunks
    while (chunks.length > 0) {
      yield chunks.shift()!;
    }
  }

  async writeFile(parentCid: CID | null, path: string, data: Uint8Array): Promise<CID> {
    const id = generateRequestId();
    const response = await this.request<{ cid?: CID; error?: string }>(
      { type: 'writeFile', id, parentCid, path, data },
      [data.buffer]
    );
    if (response.error) throw new Error(response.error);
    if (!response.cid) throw new Error('No CID returned');
    return response.cid;
  }

  async deleteFile(parentCid: CID, path: string): Promise<CID> {
    const id = generateRequestId();
    const response = await this.request<{ cid?: CID; error?: string }>({
      type: 'deleteFile',
      id,
      parentCid,
      path,
    });
    if (response.error) throw new Error(response.error);
    if (!response.cid) throw new Error('No CID returned');
    return response.cid;
  }

  async listDir(cid: CID): Promise<DirEntry[]> {
    const id = generateRequestId();
    const response = await this.request<{ entries?: DirEntry[]; error?: string }>({
      type: 'listDir',
      id,
      cid,
    });
    if (response.error) throw new Error(response.error);
    return response.entries || [];
  }

  async resolveRoot(npub: string, path?: string): Promise<CID | null> {
    const id = generateRequestId();
    const response = await this.request<{ cid?: CID; error?: string }>({
      type: 'resolveRoot',
      id,
      npub,
      path,
    });
    if (response.error) throw new Error(response.error);
    return response.cid || null;
  }

  // ============================================================================
  // Public API - Nostr
  // ============================================================================

  subscribe(
    filters: NostrFilter[],
    callback: SubscriptionCallback,
    eose?: EoseCallback
  ): string {
    const subId = generateRequestId();
    this.subscriptions.set(subId, { callback, eose });
    this.postMessage({ type: 'subscribe', id: subId, filters });
    return subId;
  }

  unsubscribe(subId: string): void {
    this.subscriptions.delete(subId);
    this.postMessage({ type: 'unsubscribe', id: generateRequestId(), subId });
  }

  async publish(event: SignedEvent): Promise<void> {
    const id = generateRequestId();
    const response = await this.request<{ error?: string }>({
      type: 'publish',
      id,
      event,
    });
    if (response.error) throw new Error(response.error);
  }

  // ============================================================================
  // Public API - Stats
  // ============================================================================

  async getPeerStats(): Promise<PeerStats[]> {
    const id = generateRequestId();
    const response = await this.request<{ stats: PeerStats[] }>({
      type: 'getPeerStats',
      id,
    });
    return response.stats;
  }

  async getRelayStats(): Promise<RelayStats[]> {
    const id = generateRequestId();
    const response = await this.request<{ stats: RelayStats[] }>({
      type: 'getRelayStats',
      id,
    });
    return response.stats;
  }

  // ============================================================================
  // Public API - Media Streaming
  // ============================================================================

  /**
   * Register a MessagePort from the service worker for media streaming
   */
  registerMediaPort(port: MessagePort): void {
    if (!this.worker) {
      console.warn('[WorkerAdapter] Cannot register media port - worker not ready');
      return;
    }
    this.worker.postMessage({ type: 'registerMediaPort', port } as WorkerRequest, [port]);
  }

  // ============================================================================
  // Identity Management
  // ============================================================================

  /**
   * Update worker's user identity (for account switching)
   */
  async setIdentity(pubkey: string, nsec?: string): Promise<void> {
    const id = generateRequestId();
    await this.request<{ error?: string }>({
      type: 'setIdentity',
      id,
      pubkey,
      nsec,
    } as WorkerRequest);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  close(): void {
    if (this.worker) {
      this.postMessage({ type: 'close', id: generateRequestId() });
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.pendingRequests.clear();
    this.subscriptions.clear();
    this.streamCallbacks.clear();
    this.messageQueue = [];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: WorkerAdapter | null = null;

export function getWorkerAdapter(): WorkerAdapter | null {
  return instance;
}

export async function initWorkerAdapter(
  workerFactory: WorkerConstructor,
  config: WorkerConfig
): Promise<WorkerAdapter> {
  if (instance) {
    return instance;
  }

  instance = new WorkerAdapter(workerFactory, config);
  await instance.init();
  return instance;
}

export function closeWorkerAdapter(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
