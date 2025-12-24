/**
 * Test helpers exposed on window for e2e tests
 * Shared between all app entry points
 */

// Extend window interface for test helpers
declare global {
  interface Window {
    __testHelpers?: { uploadSingleFile: unknown; followPubkey: unknown };
    __localStore?: unknown;
    __getWebRTCStore?: unknown;
    __getSocialGraph?: unknown;
    __socialGraph?: unknown;
    __settingsStore?: unknown;
    __setPoolSettings?: (pools: Record<string, unknown>) => void;
    __getMyPubkey?: () => string | null;
    __hashtree?: unknown;
    __getTreeRoot?: () => string | null;
    webrtcStore?: unknown;
  }
}

export function setupTestHelpers(): void {
  if (typeof window === 'undefined') return;

  import('../actions/index').then(({ uploadSingleFile }) => {
    import('../stores/follows').then(({ followPubkey }) => {
      window.__testHelpers = { uploadSingleFile, followPubkey };
    });
  });

  import('../store').then(({ webrtcStore, localStore, getWebRTCStore }) => {
    Object.defineProperty(window, 'webrtcStore', {
      get: () => webrtcStore,
      configurable: true,
    });
    window.__localStore = localStore;
    window.__getWebRTCStore = getWebRTCStore;
  });

  import('../utils/socialGraph').then(({ getSocialGraph }) => {
    window.__getSocialGraph = getSocialGraph;
    Object.defineProperty(window, '__socialGraph', {
      get: () => getSocialGraph(),
      configurable: true,
    });
  });

  import('../stores/settings').then(({ settingsStore }) => {
    window.__settingsStore = settingsStore;
    window.__setPoolSettings = (pools: Record<string, unknown>) => settingsStore.setPoolSettings(pools);
  });

  import('../nostr').then(({ useNostrStore }) => {
    window.__getMyPubkey = () => useNostrStore.getState().pubkey;
  });

  import('hashtree').then((hashtree) => {
    window.__hashtree = hashtree;
  });

  import('../stores').then(({ treeRootStore }) => {
    import('svelte/store').then(({ get }) => {
      import('hashtree').then(({ toHex }) => {
        window.__getTreeRoot = () => {
          const rootCid = get(treeRootStore);
          return rootCid?.hash ? toHex(rootCid.hash) : null;
        };
      });
    });
  });
}
