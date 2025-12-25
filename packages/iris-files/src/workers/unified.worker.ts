/**
 * Unified Worker Entry Point
 *
 * This is the worker that runs in the browser. It contains:
 * - NDK for Nostr relay connections
 * - SocialGraph for follow relationships
 * - HashTree for content-addressed storage
 * - WebRTC for peer-to-peer connections
 *
 * The worker receives messages from the main thread and handles:
 * - Storage operations (get/put/has/delete)
 * - Tree operations (read/write files, list directories)
 * - Nostr subscriptions and event publishing
 * - Social graph queries (follow distance, etc.)
 */

// Import and execute the worker code from hashtree source
// This sets up the message handler via self.onmessage
import '../../../hashtree/src/worker/worker.ts';

// Ensure this file has side effects for bundling
console.log('[UnifiedWorker] Started');
