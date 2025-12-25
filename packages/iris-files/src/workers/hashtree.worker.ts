/**
 * Hashtree Worker Entry Point
 *
 * This file is the entry point for Vite to bundle the hashtree worker.
 */

console.log('[hashtree.worker] Loading worker module...');

// Static import of the worker module (relative path)
import '../../../hashtree/src/worker/worker';

console.log('[hashtree.worker] Worker module loaded');
