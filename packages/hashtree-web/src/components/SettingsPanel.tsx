import { useEffect } from 'react';
import { navigate } from '../utils/navigate';
import { toHex } from 'hashtree';
import { nip19 } from 'nostr-tools';
import { useAppStore, formatBytes, updateStorageStats } from '../store';
import { useNostrStore } from '../nostr';
import { UserRow } from './user/UserRow';
import { useTreeRoot } from '../hooks';
import { useGraphSize, useIsRecrawling, useFollows } from '../utils/socialGraph';

export function SettingsPage() {
  const peerList = useAppStore(s => s.peers);
  const peerCountVal = useAppStore(s => s.peerCount);
  const statsVal = useAppStore(s => s.stats);
  const rootCidVal = useTreeRoot();
  const myPeerId = useAppStore(s => s.myPeerId);
  const relayList = useNostrStore(s => s.relays);
  const loggedIn = useNostrStore(s => s.isLoggedIn);
  const myPubkey = useNostrStore(s => s.pubkey);

  // Social graph stats
  const graphSize = useGraphSize();
  const isRecrawling = useIsRecrawling();
  const myFollows = useFollows(myPubkey);

  // Fetch storage stats on mount
  useEffect(() => {
    updateStorageStats();
  }, []);

  // Extract uuid from peerId (format: "pubkey:uuid")
  const getPeerUuid = (peerId: string) => peerId.split(':')[1] || peerId;

  const stateColor = (state: string) => {
    switch (state) {
      case 'connected': return '#3fb950';
      case 'connecting': return '#d29922';
      case 'failed': return '#f85149';
      default: return '#8b949e';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-surface-3 bg-surface-1 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="bg-transparent border-none text-text-2 cursor-pointer p-1 hover:bg-surface-2 rounded"
        >
          <span className="i-lucide-arrow-left text-lg" />
        </button>
        <span className="font-semibold text-text-1">Settings</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 w-full max-w-md mx-auto">
        {/* Relays */}
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            Relays ({relayList.length})
            <span
              className="i-lucide-info text-sm cursor-help"
              title="Relays are used to find peers"
            />
          </h3>
          <div className="bg-surface-2 rounded divide-y divide-surface-3">
            {relayList.map((relay) => {
              const url = new URL(relay);
              return (
                <div key={relay} className="flex items-center gap-2 p-3 text-sm">
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  <span className="text-text-1 truncate">{url.hostname}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Peers */}
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            Peers ({peerCountVal})
            <span
              className="i-lucide-info text-sm cursor-help"
              title="Peers are used to exchange data. Follows pool has priority."
            />
          </h3>
          {myPeerId && (
            <div className="text-xs text-muted mb-2 font-mono">
              Your ID: {myPeerId}
            </div>
          )}
          {loggedIn && peerList.length > 0 && (
            <div className="text-xs text-muted mb-2">
              Follows: {peerList.filter(p => p.pool === 'follows' && p.state === 'connected').length}/20 &middot; Other: {peerList.filter(p => p.pool === 'other' && p.state === 'connected').length}/10
            </div>
          )}
          {!loggedIn ? (
            <div className="bg-surface-2 rounded p-3 text-sm text-muted">
              Login to connect with peers
            </div>
          ) : peerList.length === 0 ? (
            <div className="bg-surface-2 rounded p-3 text-sm text-muted">
              No peers connected
            </div>
          ) : (
            <div className="bg-surface-2 rounded divide-y divide-surface-3">
              {peerList.map((peer) => (
                <div
                  key={peer.peerId}
                  className="flex items-center gap-2 p-3 text-sm cursor-pointer hover:bg-surface-3"
                  onClick={() => navigate(`/${nip19.npubEncode(peer.pubkey)}`)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: stateColor(peer.state) }}
                  />
                  <UserRow
                    pubkey={peer.pubkey}
                    description={peer.isSelf ? 'You' : `${peer.state}${peer.pool === 'follows' ? ' (follow)' : ''}`}
                    avatarSize={32}
                    className="flex-1 min-w-0"
                  />
                  <span className="text-xs text-muted font-mono shrink-0">
                    {getPeerUuid(peer.peerId).slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Social Graph */}
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            Social Graph
            <span
              className="i-lucide-info text-sm cursor-help"
              title="Follow network used for trust indicators"
            />
            {isRecrawling && (
              <span className="text-xs text-accent animate-pulse">crawling...</span>
            )}
          </h3>
          <div className="bg-surface-2 rounded p-3 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted">Users in graph</span>
              <span className="text-text-1">{graphSize.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Following</span>
              <span className="text-text-1">{myFollows.size.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Current Tree Stats */}
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Local Storage</h3>
          <div className="bg-surface-2 rounded p-3 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted">Items</span>
              <span className="text-text-1">{statsVal.items.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Size</span>
              <span className="text-text-1">{formatBytes(statsVal.bytes)}</span>
            </div>
            {rootCidVal && (
              <div className="pt-2 border-t border-surface-3">
                <span className="text-muted text-xs block mb-1">Root Hash</span>
                <code className="text-xs text-text-3 font-mono break-all">
                  {toHex(rootCidVal.hash)}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
