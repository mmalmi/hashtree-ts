/**
 * Settings store with Dexie persistence (Svelte version)
 */
import { writable, get } from 'svelte/store';
import Dexie, { type Table } from 'dexie';

// Pool configuration
export interface PoolSettings {
  followsMax: number;
  followsSatisfied: number;
  otherMax: number;
  otherSatisfied: number;
}

// Gitignore behavior for directory uploads
export type GitignoreBehavior = 'ask' | 'always' | 'never';

export interface UploadSettings {
  /** How to handle .gitignore files in directory uploads */
  gitignoreBehavior: GitignoreBehavior;
}

// Default pool settings
export const DEFAULT_POOL_SETTINGS: PoolSettings = {
  followsMax: 20,
  followsSatisfied: 10,
  otherMax: 10,
  otherSatisfied: 5,
};

// Default upload settings
export const DEFAULT_UPLOAD_SETTINGS: UploadSettings = {
  gitignoreBehavior: 'ask',
};

// Editor settings
export interface EditorSettings {
  /** Whether to auto-save changes while editing */
  autoSave: boolean;
}

// Default editor settings
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  autoSave: true,
};

// Sync settings for background data synchronization
export interface SyncSettings {
  /** Master toggle for background sync */
  enabled: boolean;
  /** Storage cap in bytes (default: 2GB) */
  storageCap: number;
  /** Percentage reserved for user's own trees (default: 50) */
  ownQuotaPercent: number;
  /** Sync public trees from followed users */
  syncFollowedPublic: boolean;
  /** Sync unlisted trees when visited via link */
  syncVisitedUnlisted: boolean;
}

// Default sync settings
export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: true,
  storageCap: 2 * 1024 * 1024 * 1024, // 2GB
  ownQuotaPercent: 50,
  syncFollowedPublic: true,
  syncVisitedUnlisted: true,
};

// Blossom server configuration
export interface BlossomServerConfig {
  url: string;
  read: boolean;
  write: boolean;
}

// Network settings for relays and blossom servers
export interface NetworkSettings {
  /** Nostr relay URLs */
  relays: string[];
  /** Blossom server configurations */
  blossomServers: BlossomServerConfig[];
  /** Whether negentropy sync is enabled */
  negentropyEnabled: boolean;
}

// Default network settings
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  relays: [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
  ],
  blossomServers: [
    { url: 'https://hashtree.iris.to', read: true, write: true },
    { url: 'https://blossom.nostr.build', read: true, write: true },
  ],
  negentropyEnabled: false,
};

// Dexie database for settings persistence
class SettingsDB extends Dexie {
  settings!: Table<{ key: string; value: unknown }>;

  constructor() {
    super('hashtree-settings');
    this.version(1).stores({
      settings: '&key',
    });
  }
}

const db = new SettingsDB();

export interface SettingsState {
  // Legacy settings (kept for compatibility)
  appearance: Record<string, unknown>;
  content: Record<string, unknown>;
  imgproxy: Record<string, unknown>;
  notifications: Record<string, unknown>;
  desktop: Record<string, unknown>;
  debug: Record<string, unknown>;
  legal: Record<string, unknown>;

  // Pool settings
  pools: PoolSettings;
  poolsLoaded: boolean;

  // Upload settings
  upload: UploadSettings;

  // Editor settings
  editor: EditorSettings;

  // Sync settings
  sync: SyncSettings;

  // Network settings
  network: NetworkSettings;
  networkLoaded: boolean;
}

function createSettingsStore() {
  const { subscribe, update } = writable<SettingsState>({
    // Legacy settings
    appearance: {},
    content: {},
    imgproxy: {},
    notifications: {},
    desktop: {},
    debug: {},
    legal: {},

    // Pool settings
    pools: DEFAULT_POOL_SETTINGS,
    poolsLoaded: false,

    // Upload settings
    upload: DEFAULT_UPLOAD_SETTINGS,

    // Editor settings
    editor: DEFAULT_EDITOR_SETTINGS,

    // Sync settings
    sync: DEFAULT_SYNC_SETTINGS,

    // Network settings
    network: DEFAULT_NETWORK_SETTINGS,
    networkLoaded: false,
  });

  return {
    subscribe,

    setPoolSettings: (pools: Partial<PoolSettings>) => {
      update(state => {
        const updated = { ...state.pools, ...pools };
        // Persist to Dexie
        db.settings.put({ key: 'pools', value: updated }).catch(console.error);
        return { ...state, pools: updated };
      });
    },

    resetPoolSettings: () => {
      update(state => {
        db.settings.put({ key: 'pools', value: DEFAULT_POOL_SETTINGS }).catch(console.error);
        return { ...state, pools: DEFAULT_POOL_SETTINGS };
      });
    },

    setUploadSettings: (upload: Partial<UploadSettings>) => {
      update(state => {
        const updated = { ...state.upload, ...upload };
        db.settings.put({ key: 'upload', value: updated }).catch(console.error);
        return { ...state, upload: updated };
      });
    },

    setEditorSettings: (editor: Partial<EditorSettings>) => {
      update(state => {
        const updated = { ...state.editor, ...editor };
        db.settings.put({ key: 'editor', value: updated }).catch(console.error);
        return { ...state, editor: updated };
      });
    },

    setSyncSettings: (sync: Partial<SyncSettings>) => {
      update(state => {
        const updated = { ...state.sync, ...sync };
        db.settings.put({ key: 'sync', value: updated }).catch(console.error);
        return { ...state, sync: updated };
      });
    },

    resetSyncSettings: () => {
      update(state => {
        db.settings.put({ key: 'sync', value: DEFAULT_SYNC_SETTINGS }).catch(console.error);
        return { ...state, sync: DEFAULT_SYNC_SETTINGS };
      });
    },

    setNetworkSettings: (network: Partial<NetworkSettings>) => {
      update(state => {
        const updated = { ...state.network, ...network };
        db.settings.put({ key: 'network', value: updated }).catch(console.error);
        return { ...state, network: updated };
      });
    },

    resetNetworkSettings: () => {
      update(state => {
        db.settings.put({ key: 'network', value: DEFAULT_NETWORK_SETTINGS }).catch(console.error);
        return { ...state, network: DEFAULT_NETWORK_SETTINGS };
      });
    },

    // Get current state synchronously
    getState: (): SettingsState => get(settingsStore),

    // Set state directly
    setState: (newState: Partial<SettingsState>) => {
      update(state => ({ ...state, ...newState }));
    },
  };
}

export const settingsStore = createSettingsStore();

// Legacy compatibility alias
export const useSettingsStore = settingsStore;

// Load settings from Dexie on startup
async function loadSettings() {
  try {
    const [poolsRow, uploadRow, editorRow, syncRow, networkRow] = await Promise.all([
      db.settings.get('pools'),
      db.settings.get('upload'),
      db.settings.get('editor'),
      db.settings.get('sync'),
      db.settings.get('network'),
    ]);

    const updates: Partial<SettingsState> = { poolsLoaded: true, networkLoaded: true };

    if (poolsRow?.value) {
      const pools = poolsRow.value as PoolSettings;
      updates.pools = {
        followsMax: pools.followsMax ?? DEFAULT_POOL_SETTINGS.followsMax,
        followsSatisfied: pools.followsSatisfied ?? DEFAULT_POOL_SETTINGS.followsSatisfied,
        otherMax: pools.otherMax ?? DEFAULT_POOL_SETTINGS.otherMax,
        otherSatisfied: pools.otherSatisfied ?? DEFAULT_POOL_SETTINGS.otherSatisfied,
      };
    }

    if (uploadRow?.value) {
      const upload = uploadRow.value as UploadSettings;
      updates.upload = {
        gitignoreBehavior: upload.gitignoreBehavior ?? DEFAULT_UPLOAD_SETTINGS.gitignoreBehavior,
      };
    }

    if (editorRow?.value) {
      const editor = editorRow.value as EditorSettings;
      updates.editor = {
        autoSave: editor.autoSave ?? DEFAULT_EDITOR_SETTINGS.autoSave,
      };
    }

    if (syncRow?.value) {
      const sync = syncRow.value as SyncSettings;
      updates.sync = {
        enabled: sync.enabled ?? DEFAULT_SYNC_SETTINGS.enabled,
        storageCap: sync.storageCap ?? DEFAULT_SYNC_SETTINGS.storageCap,
        ownQuotaPercent: sync.ownQuotaPercent ?? DEFAULT_SYNC_SETTINGS.ownQuotaPercent,
        syncFollowedPublic: sync.syncFollowedPublic ?? DEFAULT_SYNC_SETTINGS.syncFollowedPublic,
        syncVisitedUnlisted: sync.syncVisitedUnlisted ?? DEFAULT_SYNC_SETTINGS.syncVisitedUnlisted,
      };
    }

    if (networkRow?.value) {
      const network = networkRow.value as NetworkSettings;
      // Handle backwards compatibility: convert old string[] format to BlossomServerConfig[]
      let blossomServers = DEFAULT_NETWORK_SETTINGS.blossomServers;
      if (network.blossomServers) {
        if (Array.isArray(network.blossomServers)) {
          blossomServers = network.blossomServers.map(s =>
            typeof s === 'string' ? { url: s, read: true, write: false } : { ...s, read: s.read ?? true }
          );
        }
      }
      updates.network = {
        relays: network.relays ?? DEFAULT_NETWORK_SETTINGS.relays,
        blossomServers,
        negentropyEnabled: network.negentropyEnabled ?? DEFAULT_NETWORK_SETTINGS.negentropyEnabled,
      };
    }

    settingsStore.setState(updates);
  } catch (err) {
    console.error('[settings] error loading:', err);
    settingsStore.setState({ poolsLoaded: true, networkLoaded: true });
  }
}

// Initialize on module load
loadSettings();
