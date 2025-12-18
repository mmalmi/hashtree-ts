/**
 * Video metadata stored in metadata.json within video tree
 */
export interface VideoMetadata {
  title: string;
  description?: string;
  duration?: number; // seconds
  uploadedAt?: number; // timestamp ms
  mimeType?: string;
  width?: number;
  height?: number;
  tags?: string[];
}

/**
 * Video item for display in grids/lists
 */
export interface VideoItem {
  key: string;
  title: string;
  description?: string;
  duration?: number;
  ownerPubkey: string | null;
  ownerNpub: string | null;
  treeName: string;
  visibility?: string;
  href: string;
  timestamp?: number;
  /** Pubkey of user who reacted/commented (for social feed items) */
  reactorPubkey?: string;
}
