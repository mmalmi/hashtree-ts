/**
 * Encrypted tree editing operations
 *
 * All operations take a root key and return new hash + key.
 * Keys are propagated through the tree structure.
 */

import { Store, Hash } from '../types.js';
import { type EncryptionKey } from '../crypto.js';
import {
  putDirectoryEncrypted,
  listDirectoryEncrypted,
  type EncryptedDirEntry,
  type EncryptedTreeConfig,
} from '../encrypted.js';

export interface EncryptedEditConfig extends EncryptedTreeConfig {}

/**
 * Result of an encrypted edit operation
 */
export interface EncryptedEditResult {
  hash: Hash;
  key: EncryptionKey;
}

/**
 * Path resolution result with collected keys
 */
interface PathResolution {
  dirHash: Hash;
  dirKey: EncryptionKey;
  pathKeys: EncryptionKey[];
}

/**
 * Resolve a path and collect keys along the way
 */
async function resolvePathAndCollectKeys(
  store: Store,
  rootHash: Hash,
  rootKey: EncryptionKey,
  path: string[]
): Promise<PathResolution | null> {
  const pathKeys: EncryptionKey[] = [];
  let currentHash = rootHash;
  let currentKey = rootKey;

  for (const segment of path) {
    const entries = await listDirectoryEncrypted(store, currentHash, currentKey);
    const entry = entries.find(e => e.name === segment);

    if (!entry || !entry.key) {
      return null;
    }

    pathKeys.push(entry.key);
    currentHash = entry.hash;
    currentKey = entry.key;
  }

  return { dirHash: currentHash, dirKey: currentKey, pathKeys };
}

/**
 * Add or update an entry in an encrypted directory
 * @param config - Tree configuration
 * @param rootHash - Current root hash
 * @param rootKey - Current root key
 * @param path - Path to the directory containing the entry
 * @param name - Name of the entry to add/update
 * @param hash - Hash of the entry content
 * @param size - Size of the entry content
 * @param key - Encryption key of the entry (for encrypted content)
 * @param isTree - Whether the entry is a directory
 * @returns New root hash and key
 */
export async function setEntryEncrypted(
  config: EncryptedEditConfig,
  rootHash: Hash,
  rootKey: EncryptionKey,
  path: string[],
  name: string,
  hash: Hash,
  size: number,
  key?: EncryptionKey,
  _isTree = false
): Promise<EncryptedEditResult> {
  const { store } = config;

  // Navigate to the target directory and collect keys
  const resolved = await resolvePathAndCollectKeys(store, rootHash, rootKey, path);

  if (!resolved) {
    throw new Error(`Path not found: ${path.join('/')}`);
  }

  const { dirHash, dirKey, pathKeys } = resolved;

  // List current entries
  const entries = await listDirectoryEncrypted(store, dirHash, dirKey);

  // Filter out existing entry and add new one
  const newEntries: EncryptedDirEntry[] = entries
    .filter(e => e.name !== name)
    .map(e => ({
      name: e.name,
      hash: e.hash,
      size: e.size,
      key: e.key,
      isTreeNode: e.isTreeNode,
    }));

  newEntries.push({ name, hash, size, key, isTreeNode: _isTree });

  // Create new encrypted directory
  const newDir = await putDirectoryEncrypted(config, newEntries);

  // Rebuild the path with new directory
  return rebuildPathEncrypted(
    config,
    rootHash,
    rootKey,
    path,
    pathKeys,
    newDir.hash,
    newDir.key
  );
}

/**
 * Remove an entry from an encrypted directory
 */
export async function removeEntryEncrypted(
  config: EncryptedEditConfig,
  rootHash: Hash,
  rootKey: EncryptionKey,
  path: string[],
  name: string
): Promise<EncryptedEditResult> {
  const { store } = config;

  const resolved = await resolvePathAndCollectKeys(store, rootHash, rootKey, path);

  if (!resolved) {
    throw new Error(`Path not found: ${path.join('/')}`);
  }

  const { dirHash, dirKey, pathKeys } = resolved;

  const entries = await listDirectoryEncrypted(store, dirHash, dirKey);
  const newEntries: EncryptedDirEntry[] = entries
    .filter(e => e.name !== name)
    .map(e => ({
      name: e.name,
      hash: e.hash,
      size: e.size,
      key: e.key,
      isTreeNode: e.isTreeNode,
    }));

  const newDir = await putDirectoryEncrypted(config, newEntries);

  return rebuildPathEncrypted(
    config,
    rootHash,
    rootKey,
    path,
    pathKeys,
    newDir.hash,
    newDir.key
  );
}

/**
 * Rename an entry in an encrypted directory
 */
export async function renameEntryEncrypted(
  config: EncryptedEditConfig,
  rootHash: Hash,
  rootKey: EncryptionKey,
  path: string[],
  oldName: string,
  newName: string
): Promise<EncryptedEditResult> {
  if (oldName === newName) {
    return { hash: rootHash, key: rootKey };
  }

  const { store } = config;

  const resolved = await resolvePathAndCollectKeys(store, rootHash, rootKey, path);

  if (!resolved) {
    throw new Error(`Path not found: ${path.join('/')}`);
  }

  const { dirHash, dirKey, pathKeys } = resolved;

  const entries = await listDirectoryEncrypted(store, dirHash, dirKey);
  const entry = entries.find(e => e.name === oldName);
  if (!entry) {
    throw new Error(`Entry not found: ${oldName}`);
  }

  const newEntries: EncryptedDirEntry[] = entries
    .filter(e => e.name !== oldName)
    .map(e => ({
      name: e.name,
      hash: e.hash,
      size: e.size,
      key: e.key,
      isTreeNode: e.isTreeNode,
    }));

  newEntries.push({
    name: newName,
    hash: entry.hash,
    size: entry.size,
    key: entry.key,
    isTreeNode: entry.isTreeNode,
  });

  const newDir = await putDirectoryEncrypted(config, newEntries);

  return rebuildPathEncrypted(
    config,
    rootHash,
    rootKey,
    path,
    pathKeys,
    newDir.hash,
    newDir.key
  );
}

/**
 * Rebuild the path from a modified child up to the root
 */
async function rebuildPathEncrypted(
  config: EncryptedEditConfig,
  rootHash: Hash,
  rootKey: EncryptionKey,
  path: string[],
  pathKeys: EncryptionKey[],
  newChildHash: Hash,
  newChildKey: EncryptionKey
): Promise<EncryptedEditResult> {
  if (path.length === 0) {
    return { hash: newChildHash, key: newChildKey };
  }

  const { store } = config;
  let childHash = newChildHash;
  let childKey = newChildKey;
  const parts = [...path];

  while (parts.length > 0) {
    const childName = parts.pop()!;

    // Get parent directory
    let parentHash: Hash;
    let parentKey: EncryptionKey;

    if (parts.length === 0) {
      parentHash = rootHash;
      parentKey = rootKey;
    } else {
      // Use collected pathKeys to find the parent
      parentHash = rootHash;
      parentKey = rootKey;
      for (let i = 0; i < parts.length; i++) {
        const entries = await listDirectoryEncrypted(store, parentHash, parentKey);
        const entry = entries.find(e => e.name === parts[i]);
        if (!entry || !entry.key) {
          throw new Error(`Parent path not found: ${parts.join('/')}`);
        }
        parentHash = entry.hash;
        parentKey = pathKeys[i] ?? entry.key;
      }
    }

    // Get parent entries and update the child
    const parentEntries = await listDirectoryEncrypted(store, parentHash, parentKey);
    const newParentEntries: EncryptedDirEntry[] = parentEntries.map(e =>
      e.name === childName
        ? { name: e.name, hash: childHash, size: e.size, key: childKey, isTreeNode: e.isTreeNode }
        : { name: e.name, hash: e.hash, size: e.size, key: e.key, isTreeNode: e.isTreeNode }
    );

    const newParent = await putDirectoryEncrypted(config, newParentEntries);
    childHash = newParent.hash;
    childKey = newParent.key;
  }

  return { hash: childHash, key: childKey };
}
