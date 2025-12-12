/**
 * wasm-git wrapper for git operations
 * Uses libgit2 compiled to WebAssembly
 */

// Re-export all public APIs
export { getHeadWithWasmGit, getLogWithWasmGit, getFileLastCommitsWithWasmGit } from './log';
export type { CommitInfo } from './log';

export { getBranchesWithWasmGit, createBranchWithWasmGit } from './branch';

export { getStatusWithWasmGit } from './status';
export type { GitStatusEntry, GitStatusResult } from './status';

export { initGitRepoWithWasmGit, commitWithWasmGit } from './commit';

export { checkoutWithWasmGit } from './checkout';

export { runGitCommand } from './command';
