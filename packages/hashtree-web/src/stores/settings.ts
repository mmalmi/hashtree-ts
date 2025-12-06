/**
 * Settings store with Dexie persistence
 */
import { create } from 'zustand';
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

  // Actions
  setPoolSettings: (pools: Partial<PoolSettings>) => void;
  resetPoolSettings: () => void;
  setUploadSettings: (upload: Partial<UploadSettings>) => void;
  setEditorSettings: (editor: Partial<EditorSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
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

  setPoolSettings: (pools) => {
    const current = get().pools;
    const updated = { ...current, ...pools };
    set({ pools: updated });
    // Persist to Dexie
    db.settings.put({ key: 'pools', value: updated }).catch(console.error);
  },

  resetPoolSettings: () => {
    set({ pools: DEFAULT_POOL_SETTINGS });
    db.settings.put({ key: 'pools', value: DEFAULT_POOL_SETTINGS }).catch(console.error);
  },

  setUploadSettings: (upload) => {
    const current = get().upload;
    const updated = { ...current, ...upload };
    set({ upload: updated });
    db.settings.put({ key: 'upload', value: updated }).catch(console.error);
  },

  setEditorSettings: (editor) => {
    const current = get().editor;
    const updated = { ...current, ...editor };
    set({ editor: updated });
    db.settings.put({ key: 'editor', value: updated }).catch(console.error);
  },
}));

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

    useSettingsStore.setState(updates);
  } catch (err) {
    console.error('[settings] error loading:', err);
    useSettingsStore.setState({ poolsLoaded: true });
  }
}

// Initialize on module load
loadSettings();
