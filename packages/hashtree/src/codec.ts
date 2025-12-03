/**
 * CBOR encoding/decoding for tree nodes
 *
 * Blobs are stored raw (not CBOR-wrapped) for efficiency.
 * Tree nodes are CBOR-encoded.
 */

import { encode, decode } from 'cbor2';
import { TreeNode, NodeType, Link, Hash } from './types.js';
import { sha256 } from './hash.js';

/**
 * Internal CBOR representation of a link
 * Using short keys for compact encoding
 */
interface LinkCBOR {
  /** hash */
  h: Uint8Array;
  /** name (optional) */
  n?: string;
  /** size (optional) */
  s?: number;
  /** CHK decryption key (optional) */
  k?: Uint8Array;
  /** isTree - whether link points to directory (optional) */
  d?: boolean;
}

/**
 * Internal CBOR representation of a tree node
 */
interface TreeNodeCBOR {
  /** type = 1 for tree */
  t: 1;
  /** links */
  l: LinkCBOR[];
  /** totalSize (optional) */
  s?: number;
  /** metadata (optional) */
  m?: Record<string, unknown>;
}

/**
 * Encode a tree node to CBOR
 */
export function encodeTreeNode(node: TreeNode): Uint8Array {
  const cbor: TreeNodeCBOR = {
    t: 1,
    l: node.links.map(link => {
      const l: LinkCBOR = { h: link.hash };
      if (link.name !== undefined) l.n = link.name;
      if (link.size !== undefined) l.s = link.size;
      if (link.key !== undefined) l.k = link.key;
      if (link.isTree !== undefined) l.d = link.isTree;
      return l;
    }),
  };
  if (node.totalSize !== undefined) cbor.s = node.totalSize;
  if (node.metadata !== undefined) cbor.m = node.metadata;

  return encode(cbor);
}

/**
 * Decode CBOR to a tree node
 */
export function decodeTreeNode(data: Uint8Array): TreeNode {
  const cbor = decode(data) as TreeNodeCBOR;

  if (cbor.t !== 1) {
    throw new Error(`Invalid node type: ${cbor.t}`);
  }

  const node: TreeNode = {
    type: NodeType.Tree,
    links: cbor.l.map(l => {
      const link: Link = { hash: l.h };
      if (l.n !== undefined) link.name = l.n;
      if (l.s !== undefined) link.size = l.s;
      if (l.k !== undefined) link.key = l.k;
      if (l.d !== undefined) link.isTree = l.d;
      return link;
    }),
  };

  if (cbor.s !== undefined) node.totalSize = cbor.s;
  if (cbor.m !== undefined) node.metadata = cbor.m;

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
 * Check if data is a CBOR-encoded tree node (vs raw blob)
 * Tree nodes start with CBOR map with t=1
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
    const decoded = decode(data) as TreeNodeCBOR;
    if (decoded.t !== 1) return false;
    // Empty directory is still a directory
    if (decoded.l.length === 0) return true;
    // Directory has named links, chunked file doesn't
    return decoded.l[0].n !== undefined;
  } catch {
    return false;
  }
}
