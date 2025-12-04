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

// Default pool settings
export const DEFAULT_POOL_SETTINGS: PoolSettings = {
  followsMax: 20,
  followsSatisfied: 10,
  otherMax: 10,
  otherSatisfied: 5,
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

  // Actions
  setPoolSettings: (pools: Partial<PoolSettings>) => void;
  resetPoolSettings: () => void;
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
}));

// Load settings from Dexie on startup
async function loadSettings() {
  try {
    const poolsRow = await db.settings.get('pools');
    if (poolsRow?.value) {
      const pools = poolsRow.value as PoolSettings;
      // Validate and merge with defaults
      useSettingsStore.setState({
        pools: {
          followsMax: pools.followsMax ?? DEFAULT_POOL_SETTINGS.followsMax,
          followsSatisfied: pools.followsSatisfied ?? DEFAULT_POOL_SETTINGS.followsSatisfied,
          otherMax: pools.otherMax ?? DEFAULT_POOL_SETTINGS.otherMax,
          otherSatisfied: pools.otherSatisfied ?? DEFAULT_POOL_SETTINGS.otherSatisfied,
        },
        poolsLoaded: true,
      });
    } else {
      useSettingsStore.setState({ poolsLoaded: true });
    }
  } catch (err) {
    console.error('[settings] error loading:', err);
    useSettingsStore.setState({ poolsLoaded: true });
  }
}

// Initialize on module load
loadSettings();
