/**
 * Hashtree Worker Entry Point
 *
 * This file is the entry point for Vite to bundle the hashtree worker.
 * Import with: import HashTreeWorker from './workers/hashtree.worker?worker'
 */

// Import the worker code directly - this runs the worker's self.onmessage setup
// Using relative path to avoid alias resolution issues
import '../../../hashtree/src/worker/worker';
