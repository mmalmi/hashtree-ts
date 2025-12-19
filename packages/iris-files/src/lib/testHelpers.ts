/**
 * Test helpers exposed on window for e2e tests
 * Shared between all app entry points
 */

export function setupTestHelpers(): void {
  if (typeof window === 'undefined') return;

  import('../actions/index').then(({ uploadSingleFile }) => {
    import('../stores/follows').then(({ followPubkey }) => {
      (window as any).__testHelpers = { uploadSingleFile, followPubkey };
    });
  });

  import('../store').then(({ webrtcStore, localStore, getWebRTCStore }) => {
    Object.defineProperty(window, 'webrtcStore', {
      get: () => webrtcStore,
      configurable: true,
    });
    (window as any).__localStore = localStore;
    (window as any).__getWebRTCStore = getWebRTCStore;
  });

  import('../utils/socialGraph').then(({ getSocialGraph }) => {
    (window as any).__getSocialGraph = getSocialGraph;
    Object.defineProperty(window, '__socialGraph', {
      get: () => getSocialGraph(),
      configurable: true,
    });
  });

  import('../stores/settings').then(({ settingsStore }) => {
    (window as any).__settingsStore = settingsStore;
    (window as any).__setPoolSettings = (pools: any) => settingsStore.setPoolSettings(pools);
  });

  import('../nostr').then(({ useNostrStore }) => {
    (window as any).__getMyPubkey = () => useNostrStore.getState().pubkey;
  });

  import('hashtree').then((hashtree) => {
    (window as any).__hashtree = hashtree;
  });

  import('../stores').then(({ treeRootStore }) => {
    import('svelte/store').then(({ get }) => {
      import('hashtree').then(({ toHex }) => {
        (window as any).__getTreeRoot = () => {
          const rootCid = get(treeRootStore);
          return rootCid?.hash ? toHex(rootCid.hash) : null;
        };
      });
    });
  });
}
