/**
 * CollaboratorsModal - manage collaborator npubs for Yjs documents
 * Features:
 * - UserRow display for collaborators
 * - QR scanner for adding npubs
 * - Fuse.js search through followed users
 * - Read-only mode for viewers
 */
import { useState, useEffect, useMemo } from 'react';
import { nip19 } from 'nostr-tools';
import Fuse from 'fuse.js';
import { useModals, closeCollaboratorsModal } from '../../hooks/useModals';
import { useNostrStore } from '../../nostr';
import { useFollows, useSocialGraph } from '../../utils/socialGraph';
import { useProfile, getProfileName } from '../../hooks/useProfile';
import { UserRow } from '../user/UserRow';
import { QRScanner } from '../QRScanner';

interface SearchResult {
  pubkey: string;
  npub: string;
  name?: string;
  nip05?: string;
}

/** Extract npub from a scanned QR code text */
function extractNpubFromScan(text: string): string | null {
  // Trim and clean up text
  const cleaned = text.trim();

  // Direct npub match
  if (cleaned.startsWith('npub1') && cleaned.length === 63) {
    return cleaned;
  }

  // Try to find npub in the text (e.g., nostr:npub1...)
  const npubMatch = cleaned.match(/npub1[a-z0-9]{58}/i);
  if (npubMatch) {
    return npubMatch[0].toLowerCase();
  }

  // Try to decode hex pubkey
  if (/^[a-f0-9]{64}$/i.test(cleaned)) {
    try {
      return nip19.npubEncode(cleaned);
    } catch {
      return null;
    }
  }

  return null;
}

/** Convert npub to hex pubkey */
function npubToHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return decoded.data as string;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Preview component for a user about to be added */
function UserPreview({ npub, onConfirm, onCancel }: { npub: string; onConfirm: () => void; onCancel: () => void }) {
  const pubkey = npubToHex(npub);
  const profile = useProfile(pubkey || undefined);
  const name = getProfileName(profile, pubkey || undefined);

  return (
    <div className="bg-surface-2 rounded p-3 space-y-3">
      <div className="flex items-center gap-3">
        {pubkey ? (
          <UserRow pubkey={pubkey} avatarSize={40} />
        ) : (
          <span className="text-muted text-sm">Invalid npub</span>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-ghost flex-1 text-sm">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="btn-success flex-1 text-sm"
          disabled={!pubkey}
        >
          Add {name ? name : 'User'}
        </button>
      </div>
    </div>
  );
}

export function CollaboratorsModal() {
  const { showCollaboratorsModal, collaboratorsTarget } = useModals();
  const [npubs, setNpubs] = useState<string[]>([]);
  const [newNpub, setNewNpub] = useState('');
  const [pendingNpub, setPendingNpub] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  const userPubkey = useNostrStore(s => s.pubkey);
  const follows = useFollows(userPubkey);
  const socialGraph = useSocialGraph();

  // Read-only mode if no onSave callback
  const isReadOnly = !collaboratorsTarget?.onSave;

  // Build fuse.js search index from followed users
  const fuseIndex = useMemo(() => {
    if (!follows || follows.size === 0) return null;

    const searchItems: SearchResult[] = [];
    for (const pubkey of follows) {
      try {
        const npub = nip19.npubEncode(pubkey);
        // We'll search by pubkey and npub - names will be added as they load
        searchItems.push({
          pubkey,
          npub,
          name: undefined,
          nip05: undefined,
        });
      } catch {
        // Skip invalid pubkeys
      }
    }

    return new Fuse(searchItems, {
      keys: ['name', 'nip05', 'npub', 'pubkey'],
      includeScore: true,
      threshold: 0.4,
    });
  }, [follows]);

  // Search results
  const searchResults = useMemo(() => {
    if (!fuseIndex || !searchQuery.trim()) return [];

    const results = fuseIndex.search(searchQuery.trim(), { limit: 6 });
    // Filter out already added npubs
    return results
      .map(r => r.item)
      .filter(item => !npubs.includes(item.npub));
  }, [fuseIndex, searchQuery, npubs]);

  // Initialize state when modal opens
  useEffect(() => {
    if (showCollaboratorsModal && collaboratorsTarget) {
      setNpubs([...collaboratorsTarget.npubs]);
      setNewNpub('');
      setPendingNpub(null);
      setError(null);
      setSearchQuery('');
      setShowSearchResults(false);
    }
  }, [showCollaboratorsModal, collaboratorsTarget]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showCollaboratorsModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showQRScanner) {
          setShowQRScanner(false);
        } else if (pendingNpub) {
          setPendingNpub(null);
        } else {
          (document.activeElement as HTMLElement)?.blur();
          closeCollaboratorsModal();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCollaboratorsModal, showQRScanner, pendingNpub]);

  // Auto-detect valid npub as user types
  // Must be defined before early return to maintain consistent hook order
  const detectedNpub = useMemo(() => {
    if (!showCollaboratorsModal || !collaboratorsTarget) return null;
    if (pendingNpub) return null; // Don't detect if we already have a pending one

    // Inline validation logic to avoid closure issues
    const trimmed = newNpub.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('npub1') || trimmed.length !== 63) return null;
    if (npubs.includes(trimmed)) return null;
    return trimmed;
  }, [showCollaboratorsModal, collaboratorsTarget, newNpub, npubs, pendingNpub]);

  if (!showCollaboratorsModal || !collaboratorsTarget) return null;

  const validateNpub = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Validate npub format
    if (!trimmed.startsWith('npub1') || trimmed.length !== 63) {
      return null;
    }

    // Check for duplicates
    if (npubs.includes(trimmed)) {
      return null;
    }

    return trimmed;
  };

  const validateAndPrepareAdd = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Validate npub format
    if (!trimmed.startsWith('npub1') || trimmed.length !== 63) {
      setError('Invalid npub format. Must start with npub1 and be 63 characters.');
      return null;
    }

    // Check for duplicates
    if (npubs.includes(trimmed)) {
      setError('This npub is already in the list.');
      return null;
    }

    return trimmed;
  };

  const handlePrepareAdd = () => {
    const validated = validateAndPrepareAdd(newNpub);
    if (validated) {
      setPendingNpub(validated);
      setNewNpub('');
      setError(null);
      setShowSearchResults(false);
    }
  };

  const handleConfirmAdd = () => {
    if (pendingNpub) {
      setNpubs([...npubs, pendingNpub]);
      setPendingNpub(null);
    }
  };

  const handleRemove = (index: number) => {
    setNpubs(npubs.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (isReadOnly) return;
    collaboratorsTarget.onSave?.(npubs);
    closeCollaboratorsModal();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePrepareAdd();
    }
  };

  const handleQRScan = (result: string) => {
    const npub = extractNpubFromScan(result);
    setShowQRScanner(false);

    if (npub) {
      if (npubs.includes(npub)) {
        setError('This npub is already in the list.');
        return;
      }
      setPendingNpub(npub);
      setError(null);
    } else {
      setError('Could not find an npub in the scanned QR code.');
    }
  };

  const handleSearchSelect = (result: SearchResult) => {
    if (npubs.includes(result.npub)) {
      setError('This npub is already in the list.');
      return;
    }
    setPendingNpub(result.npub);
    setSearchQuery('');
    setShowSearchResults(false);
    setError(null);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 flex-center z-1000 overflow-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeCollaboratorsModal();
        }}
      >
        <div className="bg-surface-1 rounded-lg w-full max-w-md border border-surface-3 mx-4">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-3">
            <h2 className="text-lg font-semibold">
              {isReadOnly ? 'Editors' : 'Manage Editors'}
            </h2>
            <button
              onClick={closeCollaboratorsModal}
              className="btn-ghost p-1"
              aria-label="Close"
            >
              <span className="i-lucide-x text-lg" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            <p className="text-sm text-muted">
              {isReadOnly
                ? 'Users who can edit this document. Their changes will be merged.'
                : 'Add editors by their npub to merge their edits into this document.'}
            </p>

            {/* Current collaborators list */}
            {npubs.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Current editors:</label>
                <ul className="space-y-1">
                  {npubs.map((npub, index) => {
                    const pubkey = npubToHex(npub);
                    return (
                      <li key={index} className="flex items-center gap-2 bg-surface-2 rounded px-3 py-2">
                        {pubkey ? (
                          <UserRow pubkey={pubkey} avatarSize={32} className="flex-1 min-w-0" />
                        ) : (
                          <>
                            <span className="i-lucide-user text-muted" />
                            <span className="flex-1 text-sm font-mono truncate">{npub}</span>
                          </>
                        )}
                        {!isReadOnly && (
                          <button
                            onClick={() => handleRemove(index)}
                            className="btn-ghost p-1 text-danger shrink-0"
                            title="Remove editor"
                          >
                            <span className="i-lucide-x" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {npubs.length === 0 && (
              <div className="text-sm text-muted bg-surface-2 rounded px-3 py-2">
                No editors yet.{!isReadOnly && ' Add one below.'}
              </div>
            )}

            {/* Pending user preview (from QR scan or search) */}
            {pendingNpub && !isReadOnly && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Add this editor?</label>
                <UserPreview
                  npub={pendingNpub}
                  onConfirm={handleConfirmAdd}
                  onCancel={() => setPendingNpub(null)}
                />
              </div>
            )}

            {/* Auto-detected npub preview (from typing) */}
            {detectedNpub && !pendingNpub && !isReadOnly && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Add this editor?</label>
                <UserPreview
                  npub={detectedNpub}
                  onConfirm={() => {
                    setNpubs([...npubs, detectedNpub]);
                    setNewNpub('');
                    setError(null);
                  }}
                  onCancel={() => setNewNpub('')}
                />
              </div>
            )}

            {/* Add new collaborator (only if not read-only and no pending) */}
            {!isReadOnly && !pendingNpub && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Add editor:</label>

                {/* Search through follows */}
                {follows.size > 0 && (
                  <div className="relative">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="i-lucide-search absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setShowSearchResults(true);
                            setError(null);
                          }}
                          onFocus={() => setShowSearchResults(true)}
                          placeholder="Search followed users..."
                          className="input w-full pl-9 text-sm"
                        />
                      </div>
                    </div>

                    {/* Search results dropdown */}
                    {showSearchResults && searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 rounded border border-surface-3 shadow-lg z-10 max-h-48 overflow-auto">
                        {searchResults.map((result) => (
                          <button
                            key={result.pubkey}
                            onClick={() => handleSearchSelect(result)}
                            className="w-full px-3 py-2 hover:bg-surface-3 text-left"
                          >
                            <UserRow pubkey={result.pubkey} avatarSize={28} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Divider or label */}
                {follows.size > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="flex-1 h-px bg-surface-3" />
                    <span>or paste npub</span>
                    <span className="flex-1 h-px bg-surface-3" />
                  </div>
                )}

                {/* Manual npub input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newNpub}
                    onChange={(e) => {
                      setNewNpub(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="npub1..."
                    className="input flex-1 font-mono text-sm"
                  />
                  <button
                    onClick={() => setShowQRScanner(true)}
                    className="btn-ghost px-2"
                    title="Scan QR code"
                  >
                    <span className="i-lucide-qr-code text-lg" />
                  </button>
                  <button
                    onClick={handlePrepareAdd}
                    className="btn-success px-3"
                    disabled={!newNpub.trim()}
                  >
                    Add
                  </button>
                </div>
                {error && (
                  <p className="text-sm text-danger">{error}</p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-surface-3">
            <button onClick={closeCollaboratorsModal} className="btn-ghost">
              {isReadOnly ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button onClick={handleSave} className="btn-success">
                Save
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Scanner overlay */}
      {showQRScanner && (
        <QRScanner
          onScanSuccess={handleQRScan}
          onClose={() => setShowQRScanner(false)}
        />
      )}
    </>
  );
}
