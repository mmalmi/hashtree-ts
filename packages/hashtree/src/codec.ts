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
import { TreeNode, NodeType, Link, Hash } from './types.js';
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
  /** isTreeNode - whether link points to TreeNode (true) or raw blob (false) */
  i: boolean;
}

/**
 * Internal MessagePack representation of a tree node
 */
interface TreeNodeMsgpack {
  /** type = 1 for tree */
  t: 1;
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
    t: 1,
    l: node.links.map(link => {
      const l: LinkMsgpack = { h: link.hash, i: link.isTreeNode };
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
 * Decode MessagePack to a tree node
 */
export function decodeTreeNode(data: Uint8Array): TreeNode {
  const msgpack = decode(data) as TreeNodeMsgpack;

  if (msgpack.t !== 1) {
    throw new Error(`Invalid node type: ${msgpack.t}`);
  }

  const node: TreeNode = {
    type: NodeType.Tree,
    links: msgpack.l.map(l => {
      const link: Link = { hash: l.h, isTreeNode: l.i ?? false };
      if (l.n !== undefined) link.name = l.n;
      if (l.s !== undefined) link.size = l.s;
      if (l.k !== undefined) link.key = l.k;
      return link;
    }),
  };

  if (msgpack.s !== undefined) node.totalSize = msgpack.s;
  if (msgpack.m !== undefined) node.metadata = msgpack.m;

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
 * Check if data is a MessagePack-encoded tree node (vs raw blob)
 * Tree nodes decode to an object with t=1
 */
export function isTreeNode(data: Uint8Array): boolean {
  try {
    const decoded = decode(data) as unknown;
    return (
      typeof decoded === 'object' &&
      decoded !== null &&
      (decoded as Record<string, unknown>).t === 1
    );
  } catch {
    return false;
  }
}

/**
 * Check if data is a directory tree node (has named links)
 * vs a chunked file tree node (links have no names)
 */
export function isDirectoryNode(data: Uint8Array): boolean {
  try {
    const decoded = decode(data) as TreeNodeMsgpack;
    if (decoded.t !== 1) return false;
    // Empty directory is still a directory
    if (decoded.l.length === 0) return true;
    // Directory has named links, chunked file doesn't
    return decoded.l[0].n !== undefined;
  } catch {
    return false;
  }
}
