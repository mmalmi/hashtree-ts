/**
 * Playlist store - manages video playlists from directory structures
 *
 * A playlist is detected when a video tree has subdirectories containing videos.
 * Each subdirectory becomes a playlist item with its own video, thumbnail, and metadata.
 */

import { writable, get } from 'svelte/store';
import { getTree } from '../store';
import { getRefResolver } from '../refResolver';
import { getLocalRootCache, getLocalRootKey } from '../treeRootCache';
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

// Auto-play setting
export const autoPlayEnabled = writable<boolean>(true);

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

    // Check if entries are directories (potential video items)
    // A playlist has multiple subdirectories, each containing a video
    const videoItems: PlaylistItem[] = [];

    for (const entry of entries) {
      // Skip non-directory entries (check by trying to list as directory)
      try {
        const subEntries = await tree.listDirectory(entry.cid);
        if (!subEntries) continue;

        // Check if this subdir contains a video file
        const hasVideo = subEntries.some(e =>
          e.name.startsWith('video.') ||
          e.name.endsWith('.mp4') ||
          e.name.endsWith('.webm') ||
          e.name.endsWith('.mkv')
        );

        if (!hasVideo) continue;

        // This is a video item - extract metadata
        const item: PlaylistItem = {
          id: entry.name,
          title: entry.name, // Default to directory name
          cid: entry.cid,
        };

        // Try to load title from info.json
        const infoEntry = subEntries.find(e => e.name === 'info.json');
        if (infoEntry) {
          try {
            const infoData = await tree.readFile(infoEntry.cid);
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
              const titleData = await tree.readFile(titleEntry.cid);
              if (titleData) {
                item.title = new TextDecoder().decode(titleData);
              }
            } catch {}
          }
        }

        // Find thumbnail
        const thumbEntry = subEntries.find(e =>
          e.name.startsWith('thumbnail.') ||
          e.name.endsWith('.jpg') ||
          e.name.endsWith('.webp') ||
          e.name.endsWith('.png')
        );
        if (thumbEntry) {
          // Build SW URL for thumbnail
          item.thumbnailUrl = `/htree/${npub}/${encodeURIComponent(treeName)}/${encodeURIComponent(entry.name)}/${encodeURIComponent(thumbEntry.name)}`;
        }

        videoItems.push(item);
      } catch {
        // Not a directory, skip
        continue;
      }
    }

    // Only create playlist if we have multiple videos
    if (videoItems.length < 2) return null;

    // Sort by title
    videoItems.sort((a, b) => a.title.localeCompare(b.title));

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
 */
export function playNext(): string | null {
  const playlist = get(currentPlaylist);
  if (!playlist || playlist.items.length === 0) return null;

  const nextIndex = (playlist.currentIndex + 1) % playlist.items.length;
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

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
