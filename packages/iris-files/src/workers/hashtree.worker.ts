/**
 * Hashtree Worker Entry Point
 *
 * This file is the entry point for Vite to bundle the hashtree worker.
 */

// Import the worker code directly - this runs the worker's self.onmessage setup
// Aliases don't work inside workers with Vite, must use relative path
import '../../../hashtree/src/worker/worker';
