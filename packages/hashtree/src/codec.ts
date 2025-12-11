/**
 * MessagePack encoding/decoding for tree nodes
 *
 * Blobs are stored raw (not wrapped) for efficiency.
 * Tree nodes are MessagePack-encoded.
 *
 * **Determinism:** We ensure deterministic output by:
 * 1. Using fixed field order in the encoded map
 * 2. Sorting metadata keys alphabetically before encoding
 */

import { encode, decode } from '@msgpack/msgpack';
import { TreeNode, Link, LinkType, Hash } from './types.js';
import { sha256 } from './hash.js';

/**
 * Internal MessagePack representation of a link
 * Using short keys for compact encoding
 */
interface LinkMsgpack {
  /** hash */
  h: Uint8Array;
  /** name (optional) */
  n?: string;
  /** size (optional) */
  s?: number;
  /** CHK decryption key (optional) */
  k?: Uint8Array;
  /** type - 0=Blob, 1=File, 2=Dir */
  t: number;
}

/**
 * Internal MessagePack representation of a tree node
 */
interface TreeNodeMsgpack {
  /** type - 1=File, 2=Dir */
  t: number;
  /** links */
  l: LinkMsgpack[];
  /** totalSize (optional) */
  s?: number;
  /** metadata (optional) - keys must be sorted for determinism */
  m?: Record<string, unknown>;
}

/**
 * Sort object keys alphabetically for deterministic encoding
 */
function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}

/**
 * Encode a tree node to MessagePack
 */
export function encodeTreeNode(node: TreeNode): Uint8Array {
  const msgpack: TreeNodeMsgpack = {
    t: node.type,
    l: node.links.map(link => {
      const l: LinkMsgpack = { h: link.hash, t: link.type };
      if (link.name !== undefined) l.n = link.name;
      if (link.size !== undefined) l.s = link.size;
      if (link.key !== undefined) l.k = link.key;
      return l;
    }),
  };
  if (node.totalSize !== undefined) msgpack.s = node.totalSize;
  // Sort metadata keys for deterministic encoding
  if (node.metadata !== undefined) msgpack.m = sortObjectKeys(node.metadata);

  return encode(msgpack);
}

/**
 * Try to decode MessagePack data as a tree node
 * Returns null if data is not a valid tree node (i.e., it's a raw blob)
 */
export function tryDecodeTreeNode(data: Uint8Array): TreeNode | null {
  try {
    const msgpack = decode(data) as TreeNodeMsgpack;

    if (msgpack.t !== LinkType.File && msgpack.t !== LinkType.Dir) {
      return null;
    }

    const node: TreeNode = {
      type: msgpack.t as LinkType.File | LinkType.Dir,
      links: msgpack.l.map(l => {
        const link: Link = { hash: l.h, type: l.t ?? LinkType.Blob };
        if (l.n !== undefined) link.name = l.n;
        if (l.s !== undefined) link.size = l.s;
        if (l.k !== undefined) link.key = l.k;
        return link;
      }),
    };

    if (msgpack.s !== undefined) node.totalSize = msgpack.s;
    if (msgpack.m !== undefined) node.metadata = msgpack.m;

    return node;
  } catch {
    return null;
  }
}

/**
 * Decode MessagePack to a tree node (throws if not a tree node)
 */
export function decodeTreeNode(data: Uint8Array): TreeNode {
  const node = tryDecodeTreeNode(data);
  if (!node) {
    throw new Error('Data is not a valid tree node');
  }
  return node;
}

/**
 * Encode a tree node and compute its hash
 */
export async function encodeAndHash(node: TreeNode): Promise<{ data: Uint8Array; hash: Hash }> {
  const data = encodeTreeNode(node);
  const hash = await sha256(data);
  return { data, hash };
}

/**
 * Get the type of a chunk: File, Dir, or Blob
 */
export function getNodeType(data: Uint8Array): LinkType {
  const node = tryDecodeTreeNode(data);
  return node?.type ?? LinkType.Blob;
}

/**
 * Check if data is a tree node (File or Dir, not raw Blob)
 */
export function isTreeNode(data: Uint8Array): boolean {
  return tryDecodeTreeNode(data) !== null;
}

/**
 * Check if data is a directory tree node (type=Dir)
 */
export function isDirectoryNode(data: Uint8Array): boolean {
  try {
    const decoded = decode(data) as TreeNodeMsgpack;
    return decoded.t === LinkType.Dir;
  } catch {
    return false;
  }
}

/**
 * Check if data is a file tree node (type=File)
 */
export function isFileNode(data: Uint8Array): boolean {
  try {
    const decoded = decode(data) as TreeNodeMsgpack;
    return decoded.t === LinkType.File;
  } catch {
    return false;
  }
}
