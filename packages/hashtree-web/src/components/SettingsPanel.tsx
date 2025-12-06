import { useEffect } from 'react';
import { navigate } from '../utils/navigate';
import { toHex } from 'hashtree';
import { nip19 } from 'nostr-tools';
import { useAppStore, formatBytes, updateStorageStats } from '../store';
import { useNostrStore } from '../nostr';
import { UserRow } from './user/UserRow';
import { NavButton } from './NavButton';
import { useTreeRoot } from '../hooks';
import { useGraphSize, useIsRecrawling, useFollows } from '../utils/socialGraph';
import { useSettingsStore, DEFAULT_POOL_SETTINGS, type GitignoreBehavior } from '../stores/settings';

export function SettingsPage() {
  const peerList = useAppStore(s => s.peers);
  const peerCountVal = useAppStore(s => s.peerCount);
  const statsVal = useAppStore(s => s.stats);
  const wsFallback = useAppStore(s => s.wsFallback);
  const rootCidVal = useTreeRoot();
  const myPeerId = useAppStore(s => s.myPeerId);
  const relayList = useNostrStore(s => s.relays);
  const loggedIn = useNostrStore(s => s.isLoggedIn);
  const myPubkey = useNostrStore(s => s.pubkey);

  // Social graph stats
  const graphSize = useGraphSize();
  const isRecrawling = useIsRecrawling();
  const myFollows = useFollows(myPubkey);

  // Pool settings
  const poolSettings = useSettingsStore(s => s.pools);
  const poolsLoaded = useSettingsStore(s => s.poolsLoaded);
  const setPoolSettings = useSettingsStore(s => s.setPoolSettings);
  const resetPoolSettings = useSettingsStore(s => s.resetPoolSettings);

  // Upload settings
  const uploadSettings = useSettingsStore(s => s.upload);
  const setUploadSettings = useSettingsStore(s => s.setUploadSettings);

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
        <NavButton onClick={() => navigate('/')} />
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
            {wsFallback.url && (
              <div className="flex items-center gap-2 p-3 text-sm">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${wsFallback.connected ? 'bg-success' : 'bg-warning'}`}
                />
                <span className="text-text-1 truncate">
                  {(() => {
                    try {
                      return new URL(wsFallback.url).hostname;
                    } catch {
                      return wsFallback.url;
                    }
                  })()}
                </span>
                <span className="text-muted text-xs ml-auto">(data fallback)</span>
              </div>
            )}
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
              Follows: {peerList.filter(p => p.pool === 'follows' && p.state === 'connected').length}/{poolSettings.followsMax} &middot; Other: {peerList.filter(p => p.pool === 'other' && p.state === 'connected').length}/{poolSettings.otherMax}
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
                    showBadge
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

        {/* Pool Settings */}
        {loggedIn && poolsLoaded && (
          <div>
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              Connection Pools
              <span
                className="i-lucide-info text-sm cursor-help"
                title="Configure max peers per pool. Changes apply immediately."
              />
            </h3>
            <div className="bg-surface-2 rounded p-3 space-y-4">
              {/* Follows pool */}
              <div>
                <div className="text-sm text-text-1 mb-2">Follows Pool</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted block mb-1">Max</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={poolSettings.followsMax}
                      onChange={(e) => setPoolSettings({ followsMax: Math.max(0, Math.min(50, parseInt(e.target.value) || 0)) })}
                      className="w-full bg-surface-3 border border-surface-4 rounded px-2 py-1 text-sm text-text-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">Satisfied</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={poolSettings.followsSatisfied}
                      onChange={(e) => setPoolSettings({ followsSatisfied: Math.max(0, Math.min(50, parseInt(e.target.value) || 0)) })}
                      className="w-full bg-surface-3 border border-surface-4 rounded px-2 py-1 text-sm text-text-1"
                    />
                  </div>
                </div>
              </div>
              {/* Other pool */}
              <div>
                <div className="text-sm text-text-1 mb-2">Other Pool</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted block mb-1">Max</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={poolSettings.otherMax}
                      onChange={(e) => setPoolSettings({ otherMax: Math.max(0, Math.min(50, parseInt(e.target.value) || 0)) })}
                      className="w-full bg-surface-3 border border-surface-4 rounded px-2 py-1 text-sm text-text-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">Satisfied</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={poolSettings.otherSatisfied}
                      onChange={(e) => setPoolSettings({ otherSatisfied: Math.max(0, Math.min(50, parseInt(e.target.value) || 0)) })}
                      className="w-full bg-surface-3 border border-surface-4 rounded px-2 py-1 text-sm text-text-1"
                    />
                  </div>
                </div>
              </div>
              {/* Reset button */}
              <button
                onClick={resetPoolSettings}
                className="text-xs text-accent hover:underline"
              >
                Reset to defaults ({DEFAULT_POOL_SETTINGS.followsMax}/{DEFAULT_POOL_SETTINGS.followsSatisfied} follows, {DEFAULT_POOL_SETTINGS.otherMax}/{DEFAULT_POOL_SETTINGS.otherSatisfied} other)
              </button>
            </div>
          </div>
        )}

        {/* Upload Settings */}
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            Upload Settings
            <span
              className="i-lucide-info text-sm cursor-help"
              title="Configure how directory uploads are handled"
            />
          </h3>
          <div className="bg-surface-2 rounded p-3 space-y-3">
            <div>
              <div className="text-sm text-text-1 mb-2">.gitignore handling</div>
              <p className="text-xs text-muted mb-3">
                When uploading a directory with a .gitignore file, how should ignored files be handled?
              </p>
              <div className="space-y-2">
                {([
                  { value: 'ask', label: 'Ask each time', desc: 'Show a prompt when .gitignore is detected' },
                  { value: 'always', label: 'Always skip ignored', desc: 'Automatically skip files matching .gitignore' },
                  { value: 'never', label: 'Upload everything', desc: 'Ignore .gitignore and upload all files' },
                ] as { value: GitignoreBehavior; label: string; desc: string }[]).map(({ value, label, desc }) => (
                  <label
                    key={value}
                    className={`flex items-start gap-3 p-2 rounded cursor-pointer ${
                      uploadSettings.gitignoreBehavior === value ? 'bg-accent/10' : 'hover:bg-surface-3'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gitignoreBehavior"
                      value={value}
                      checked={uploadSettings.gitignoreBehavior === value}
                      onChange={() => setUploadSettings({ gitignoreBehavior: value })}
                      className="mt-0.5 accent-accent"
                    />
                    <div>
                      <div className="text-sm text-text-1">{label}</div>
                      <div className="text-xs text-muted">{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
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
