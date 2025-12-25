/**
 * Playlist store - manages video playlists from directory structures
 *
 * A playlist is detected when a video tree has subdirectories containing videos.
 * Each subdirectory becomes a playlist item with its own video, thumbnail, and metadata.
 *
 * Key thresholds (from playlistDetection.ts):
 * - MIN_VIDEOS_FOR_STRUCTURE (1): Minimum to consider it a playlist structure
 * - MIN_VIDEOS_FOR_SIDEBAR (2): Minimum to show playlist navigation sidebar
 */

import { writable, get } from 'svelte/store';
import { getTree } from '../store';
import { getRefResolver } from '../refResolver';
import { getLocalRootCache, getLocalRootKey } from '../treeRootCache';
import {
  MIN_VIDEOS_FOR_SIDEBAR,
  hasVideoFile,
  findThumbnailEntry,
  buildThumbnailUrl,
} from '../utils/playlistDetection';
import type { CID } from 'hashtree';

export interface PlaylistItem {
  id: string;           // Directory name (e.g., video ID)
  title: string;        // From info.json or title.txt
  thumbnailUrl?: string; // SW URL to thumbnail
  duration?: number;    // From info.json (seconds)
  cid: CID;            // CID of the video subdirectory
}

export interface Playlist {
  name: string;         // Channel/playlist name
  items: PlaylistItem[];
  currentIndex: number;
  npub: string;
  treeName: string;     // e.g., "videos/Channel Name"
}

// Current playlist state
export const currentPlaylist = writable<Playlist | null>(null);

// Repeat modes: 'none' = stop at end, 'all' = loop playlist, 'one' = loop current video
export type RepeatMode = 'none' | 'all' | 'one';
export const repeatMode = writable<RepeatMode>('none');

// Shuffle mode: when enabled, playNext picks a random video
export const shuffleEnabled = writable<boolean>(false);

// Cycle through repeat modes
export function cycleRepeatMode(): RepeatMode {
  let newMode: RepeatMode = 'none';
  repeatMode.update(mode => {
    if (mode === 'none') newMode = 'all';
    else if (mode === 'all') newMode = 'one';
    else newMode = 'none';
    return newMode;
  });
  return newMode;
}

// Toggle shuffle
export function toggleShuffle(): boolean {
  let enabled = false;
  shuffleEnabled.update(v => {
    enabled = !v;
    return enabled;
  });
  return enabled;
}

/**
 * Load playlist from a video tree that has subdirectories
 * @param npub Owner's npub
 * @param treeName Full tree name (e.g., "videos/Channel Name")
 * @param rootCid Root CID of the tree
 * @param currentVideoId Currently playing video's directory name
 */
export async function loadPlaylist(
  npub: string,
  treeName: string,
  rootCid: CID,
  currentVideoId?: string
): Promise<Playlist | null> {
  const tree = getTree();

  try {
    // List root directory
    const entries = await tree.listDirectory(rootCid);
    if (!entries || entries.length === 0) return null;

    // Check entries in parallel with timeout to avoid hanging on unavailable data
    const videoItems: PlaylistItem[] = [];

    const checkEntry = async (entry: typeof entries[0]): Promise<PlaylistItem | null> => {
      try {
        // Timeout after 3 seconds per entry
        const subEntries = await Promise.race([
          tree.listDirectory(entry.cid),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (!subEntries || !hasVideoFile(subEntries)) return null;

        // This is a video item - extract metadata
        const item: PlaylistItem = {
          id: entry.name,
          title: entry.name, // Default to directory name
          cid: entry.cid,
        };

        // Try to load title from info.json (with timeout)
        const infoEntry = subEntries.find(e => e.name === 'info.json');
        if (infoEntry) {
          try {
            const infoData = await Promise.race([
              tree.readFile(infoEntry.cid),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
            ]);
            if (infoData) {
              const info = JSON.parse(new TextDecoder().decode(infoData));
              item.title = info.title || item.title;
              item.duration = info.duration;
            }
          } catch {}
        }

        // Try to load title from title.txt if no info.json
        if (item.title === entry.name) {
          const titleEntry = subEntries.find(e => e.name === 'title.txt');
          if (titleEntry) {
            try {
              const titleData = await Promise.race([
                tree.readFile(titleEntry.cid),
                new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
              ]);
              if (titleData) {
                item.title = new TextDecoder().decode(titleData);
              }
            } catch {}
          }
        }

        // Find thumbnail using shared utility
        const thumbEntry = findThumbnailEntry(subEntries);
        if (thumbEntry) {
          item.thumbnailUrl = buildThumbnailUrl(npub, treeName, entry.name, thumbEntry.name);
        }

        return item;
      } catch {
        return null;
      }
    };

    // Check all entries in parallel
    const results = await Promise.all(entries.map(checkEntry));
    for (const item of results) {
      if (item) videoItems.push(item);
    }

    // Only show playlist sidebar if we have enough videos for navigation
    if (videoItems.length < MIN_VIDEOS_FOR_SIDEBAR) return null;

    // Sort by folder name (id) for consistent ordering with initial navigation
    videoItems.sort((a, b) => a.id.localeCompare(b.id));

    // Find current index
    let currentIndex = 0;
    if (currentVideoId) {
      const idx = videoItems.findIndex(v => v.id === currentVideoId);
      if (idx !== -1) currentIndex = idx;
    }

    // Extract playlist name from treeName (e.g., "videos/Channel Name" -> "Channel Name")
    const name = treeName.replace(/^videos\//, '');

    const playlist: Playlist = {
      name,
      items: videoItems,
      currentIndex,
      npub,
      treeName,
    };

    currentPlaylist.set(playlist);
    return playlist;
  } catch (e) {
    console.error('Failed to load playlist:', e);
    return null;
  }
}

/**
 * Navigate to next video in playlist
 * @param options.shuffle Override shuffle setting (for auto-play)
 * @param options.wrap Whether to wrap around to start (for repeat all)
 */
export function playNext(options?: { shuffle?: boolean; wrap?: boolean }): string | null {
  const playlist = get(currentPlaylist);
  if (!playlist || playlist.items.length === 0) return null;

  const shuffle = options?.shuffle ?? get(shuffleEnabled);
  const wrap = options?.wrap ?? true;

  let nextIndex: number;

  if (shuffle) {
    // Pick random video (different from current if possible)
    if (playlist.items.length === 1) {
      nextIndex = 0;
    } else {
      do {
        nextIndex = Math.floor(Math.random() * playlist.items.length);
      } while (nextIndex === playlist.currentIndex);
    }
  } else {
    // Sequential: go to next
    nextIndex = playlist.currentIndex + 1;
    if (nextIndex >= playlist.items.length) {
      if (wrap) {
        nextIndex = 0;
      } else {
        return null; // End of playlist
      }
    }
  }

  const nextItem = playlist.items[nextIndex];
  currentPlaylist.update(p => p ? { ...p, currentIndex: nextIndex } : null);

  // Return URL hash for navigation
  return `#/${playlist.npub}/${encodeURIComponent(playlist.treeName)}/${encodeURIComponent(nextItem.id)}`;
}

/**
 * Navigate to previous video in playlist
 */
export function playPrevious(): string | null {
  const playlist = get(currentPlaylist);
  if (!playlist || playlist.items.length === 0) return null;

  const prevIndex = playlist.currentIndex === 0
    ? playlist.items.length - 1
    : playlist.currentIndex - 1;
  const prevItem = playlist.items[prevIndex];

  currentPlaylist.update(p => p ? { ...p, currentIndex: prevIndex } : null);

  return `#/${playlist.npub}/${encodeURIComponent(playlist.treeName)}/${encodeURIComponent(prevItem.id)}`;
}

/**
 * Navigate to specific video by index
 */
export function playAt(index: number): string | null {
  const playlist = get(currentPlaylist);
  if (!playlist || index < 0 || index >= playlist.items.length) return null;

  const item = playlist.items[index];
  currentPlaylist.update(p => p ? { ...p, currentIndex: index } : null);

  return `#/${playlist.npub}/${encodeURIComponent(playlist.treeName)}/${encodeURIComponent(item.id)}`;
}

/**
 * Load playlist when viewing a video inside a playlist
 * Resolves the parent tree and loads the playlist
 * @param npub Owner's npub
 * @param parentTreeName Parent tree name (e.g., "videos/Channel Name")
 * @param currentVideoId Current video's directory name
 */
export async function loadPlaylistFromVideo(
  npub: string,
  parentTreeName: string,
  currentVideoId: string
): Promise<Playlist | null> {
  try {
    let parentRoot: CID | null = null;

    // Check local cache first (for recently uploaded playlists)
    const localHash = getLocalRootCache(npub, parentTreeName);
    if (localHash) {
      const localKey = getLocalRootKey(npub, parentTreeName);
      parentRoot = { hash: localHash, key: localKey };
      console.log('[Playlist] Found in local cache:', parentTreeName);
    }

    // If not in local cache, try resolver
    if (!parentRoot) {
      const resolver = getRefResolver();
      parentRoot = await resolver.resolve(npub, parentTreeName);
    }

    if (!parentRoot) {
      console.log('[Playlist] Could not resolve parent tree:', parentTreeName);
      return null;
    }

    // Load the playlist from the parent tree
    return loadPlaylist(npub, parentTreeName, parentRoot, currentVideoId);
  } catch (e) {
    console.error('Failed to load playlist from video:', e);
    return null;
  }
}

/**
 * Clear current playlist
 */
export function clearPlaylist() {
  currentPlaylist.set(null);
}
