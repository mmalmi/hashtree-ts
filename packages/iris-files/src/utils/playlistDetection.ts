/**
 * Playlist detection utilities
 *
 * A "playlist" is a tree with subdirectories that contain videos.
 * A single video has video.mp4 etc. directly at the root.
 *
 * Key thresholds:
 * - STRUCTURE: 1+ video subdirs = playlist structure (for UI/display purposes)
 * - SIDEBAR: 2+ video subdirs = show playlist sidebar (1 video has no navigation)
 */

import { getTree } from '../store';
import type { CID } from 'hashtree';

/** Minimum videos to show playlist sidebar (1 video has nowhere to navigate) */
export const MIN_VIDEOS_FOR_SIDEBAR = 2;

/** Minimum videos to consider a playlist structure (for display/categorization) */
export const MIN_VIDEOS_FOR_STRUCTURE = 1;

/** Video file extensions we recognize */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v'] as const;

/** Thumbnail file patterns */
export const THUMBNAIL_PATTERNS = ['thumbnail.jpg', 'thumbnail.webp', 'thumbnail.png'] as const;

export interface PlaylistVideoInfo {
  id: string;           // Directory name
  title: string;        // From title.txt or info.json
  cid: CID;
  thumbnailPath?: string;  // Relative path to thumbnail within video dir
  duration?: number;
}

export interface PlaylistDetectionResult {
  isPlaylist: boolean;           // Has video subdirectories?
  videoCount: number;            // Number of videos found
  firstThumbnailPath?: string;   // Path to first found thumbnail
  videos?: PlaylistVideoInfo[];  // Optional: full video info if requested
}

/**
 * Check if an entry contains a video file
 */
export function hasVideoFile(entries: { name: string }[]): boolean {
  return entries.some(e =>
    e.name.startsWith('video.') ||
    VIDEO_EXTENSIONS.some(ext => e.name.endsWith(ext))
  );
}

/**
 * Find thumbnail entry in a directory
 */
export function findThumbnailEntry(entries: { name: string }[]): { name: string } | undefined {
  return entries.find(e =>
    e.name.startsWith('thumbnail.') ||
    e.name.endsWith('.jpg') ||
    e.name.endsWith('.webp') ||
    e.name.endsWith('.png')
  );
}

/**
 * Build SW URL for a thumbnail
 */
export function buildThumbnailUrl(
  npub: string,
  treeName: string,
  videoDir: string,
  thumbName: string
): string {
  return `/htree/${npub}/${encodeURIComponent(treeName)}/${encodeURIComponent(videoDir)}/${encodeURIComponent(thumbName)}`;
}

/**
 * Find the first video entry in a playlist directory (with timeout).
 * Returns the entry name or null if not a playlist.
 */
export async function findFirstVideoEntry(rootCid: CID, timeoutMs = 2000): Promise<string | null> {
  const tree = getTree();

  try {
    const entries = await tree.listDirectory(rootCid);
    if (!entries || entries.length === 0) return null;

    for (const entry of entries) {
      try {
        // Timeout per entry to avoid hanging
        const subEntries = await Promise.race([
          tree.listDirectory(entry.cid),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
        if (subEntries && hasVideoFile(subEntries)) {
          return entry.name;
        }
      } catch {
        // Entry not available or not a directory, try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect if a tree is a playlist and get basic stats
 * Fast version - just counts videos without loading titles
 */
export async function detectPlaylist(rootCid: CID): Promise<PlaylistDetectionResult> {
  const tree = getTree();

  try {
    const entries = await tree.listDirectory(rootCid);
    if (!entries || entries.length === 0) {
      return { isPlaylist: false, videoCount: 0 };
    }

    let videoCount = 0;
    let firstThumbnailPath: string | undefined;

    for (const entry of entries) {
      try {
        const subEntries = await tree.listDirectory(entry.cid);
        if (!subEntries) continue;

        if (hasVideoFile(subEntries)) {
          videoCount++;

          if (!firstThumbnailPath) {
            const thumbEntry = findThumbnailEntry(subEntries);
            if (thumbEntry) {
              firstThumbnailPath = `${entry.name}/${thumbEntry.name}`;
            }
          }
        }
      } catch {
        // Not a directory, skip
      }
    }

    return {
      isPlaylist: videoCount >= MIN_VIDEOS_FOR_STRUCTURE,
      videoCount,
      firstThumbnailPath,
    };
  } catch {
    return { isPlaylist: false, videoCount: 0 };
  }
}

/**
 * Detect playlist with full video info (for playlist sidebar)
 * Slower but returns title and duration for each video
 */
export async function detectPlaylistWithDetails(
  rootCid: CID,
  _npub: string,
  _treeName: string
): Promise<PlaylistDetectionResult & { videos: PlaylistVideoInfo[] }> {
  const tree = getTree();
  const videos: PlaylistVideoInfo[] = [];
  let firstThumbnailPath: string | undefined;

  try {
    const entries = await tree.listDirectory(rootCid);
    if (!entries || entries.length === 0) {
      return { isPlaylist: false, videoCount: 0, videos: [] };
    }

    for (const entry of entries) {
      try {
        const subEntries = await tree.listDirectory(entry.cid);
        if (!subEntries || !hasVideoFile(subEntries)) continue;

        const videoInfo: PlaylistVideoInfo = {
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
              videoInfo.title = info.title || videoInfo.title;
              videoInfo.duration = info.duration;
            }
          } catch {}
        }

        // Try to load title from title.txt if no info.json
        if (videoInfo.title === entry.name) {
          const titleEntry = subEntries.find(e => e.name === 'title.txt');
          if (titleEntry) {
            try {
              const titleData = await tree.readFile(titleEntry.cid);
              if (titleData) {
                videoInfo.title = new TextDecoder().decode(titleData);
              }
            } catch {}
          }
        }

        // Find thumbnail
        const thumbEntry = findThumbnailEntry(subEntries);
        if (thumbEntry) {
          videoInfo.thumbnailPath = `${entry.name}/${thumbEntry.name}`;
          if (!firstThumbnailPath) {
            firstThumbnailPath = videoInfo.thumbnailPath;
          }
        }

        videos.push(videoInfo);
      } catch {
        // Not a directory, skip
      }
    }

    // Sort by folder name for consistent ordering
    videos.sort((a, b) => a.id.localeCompare(b.id));

    return {
      isPlaylist: videos.length >= MIN_VIDEOS_FOR_STRUCTURE,
      videoCount: videos.length,
      firstThumbnailPath,
      videos,
    };
  } catch {
    return { isPlaylist: false, videoCount: 0, videos: [] };
  }
}
