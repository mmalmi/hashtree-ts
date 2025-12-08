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
  network: {
    negentropyEnabled: boolean;
  };
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
}

function createSettingsStore() {
  const { subscribe, set, update } = writable<SettingsState>({
    // Legacy settings
    appearance: {},
    content: {},
    imgproxy: {},
    notifications: {},
    network: {
      negentropyEnabled: false,
    },
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
    const [poolsRow, uploadRow, editorRow] = await Promise.all([
      db.settings.get('pools'),
      db.settings.get('upload'),
      db.settings.get('editor'),
    ]);

    const updates: Partial<SettingsState> = { poolsLoaded: true };

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

    settingsStore.setState(updates);
  } catch (err) {
    console.error('[settings] error loading:', err);
    settingsStore.setState({ poolsLoaded: true });
  }
}

// Initialize on module load
loadSettings();
