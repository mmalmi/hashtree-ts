/**
 * Persistent cache for playlist detection results
 * Stores whether a tree is a playlist (has 2+ video subdirectories)
 */

const STORAGE_KEY = 'hashtree:playlistCache';
const CACHE_VERSION = 1;

export interface PlaylistCacheEntry {
  isPlaylist: boolean;
  videoCount: number;
  thumbnailUrl?: string;
  /** Hash of the tree root when detection was done */
  hashHex: string;
  /** Timestamp when cached */
  cachedAt: number;
}

interface PlaylistCacheData {
  version: number;
  entries: Record<string, PlaylistCacheEntry>; // key: "npub/treeName"
}

let cache: PlaylistCacheData | null = null;

function loadCache(): PlaylistCacheData {
  if (cache) return cache;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.version === CACHE_VERSION) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    // Ignore parse errors
  }

  cache = { version: CACHE_VERSION, entries: {} };
  return cache;
}

function saveCache() {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get cached playlist info for a tree
 * Returns null if not cached or if hashHex changed (tree was updated)
 */
export function getPlaylistCache(npub: string, treeName: string, hashHex: string): PlaylistCacheEntry | null {
  const data = loadCache();
  const key = `${npub}/${treeName}`;
  const entry = data.entries[key];

  // Return cached entry only if hash matches (tree hasn't changed)
  if (entry && entry.hashHex === hashHex) {
    return entry;
  }

  return null;
}

/**
 * Cache playlist detection result
 */
export function setPlaylistCache(
  npub: string,
  treeName: string,
  hashHex: string,
  isPlaylist: boolean,
  videoCount: number,
  thumbnailUrl?: string
) {
  const data = loadCache();
  const key = `${npub}/${treeName}`;

  data.entries[key] = {
    isPlaylist,
    videoCount,
    thumbnailUrl,
    hashHex,
    cachedAt: Date.now(),
  };

  saveCache();
}

/**
 * Get all cached playlist entries (for quick initial render)
 */
export function getAllPlaylistCache(): Record<string, PlaylistCacheEntry> {
  return loadCache().entries;
}

/**
 * Clear the playlist cache
 */
export function clearPlaylistCache() {
  cache = { version: CACHE_VERSION, entries: {} };
  saveCache();
}
