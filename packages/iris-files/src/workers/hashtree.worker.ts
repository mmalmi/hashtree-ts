/**
 * Hashtree Worker Entry Point
 *
 * This file is the entry point for Vite to bundle the hashtree worker.
 */

// Import the worker code directly - this runs the worker's self.onmessage setup
// Must use relative path - aliases don't work inside workers
import '../../../hashtree/src/worker/worker';
