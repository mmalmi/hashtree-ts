import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, useParams, Link } from 'react-router-dom';
import { toHex, fromHex } from 'hashtree';
import {
  FileBrowser,
  Preview,
  CreateModal,
  RenameModal,
  NostrLogin,
  ConnectivityIndicator,
  SearchInput,
  AppMenu,
  SettingsPage,
  WalletPage,
  ProfileView,
  FollowsPage,
  StreamView,
} from './components';
import { EditProfilePage } from './components/EditProfilePage';
import {
  useAppStore,
  getTree,
} from './store';
import { markFilesChanged } from './hooks/useRecentlyChanged';
import { nip19 } from 'nostr-tools';
import {
  useNostrStore,
  restoreSession,
} from './nostr';
import { useSelectedFile, useRoute } from './hooks';

// Shared layout wrapper - uses URL-derived selection to show/hide on mobile
function ExplorerLayout({ children }: { children: React.ReactNode }) {
  // Use URL path to determine if file is selected - more stable than entries-based detection
  // This prevents layout shifts during merkle root updates when entries change
  const route = useRoute();
  const hasFileSelected = route.path.length > 0;

  return (
    <>
      {/* File browser - hidden on mobile when file selected */}
      <div className={
        hasFileSelected
          ? 'hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col'
          : 'flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col'
      }>
        {children}
      </div>
      {/* Preview - shown on mobile when file selected */}
      <div className={
        hasFileSelected
          ? 'flex flex-1 flex-col min-w-0 min-h-0'
          : 'hidden lg:flex flex-1 flex-col min-w-0 min-h-0'
      }>
        <Preview />
      </div>
    </>
  );
}

// Route: Home (no npub, no tree)
function HomeRoute() {
  useEffect(() => {
    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    appStore.setEntries([]);
    nostrStore.setSelectedTree(null);
  }, []);

  return (
    <ExplorerLayout>
      <FileBrowser />
    </ExplorerLayout>
  );
}

// Route: User's tree list (shows profile in preview pane)
function UserRouteInner() {
  const { npub } = useParams<{ npub: string }>();

  useEffect(() => {
    if (!npub) return;
    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    appStore.setEntries([]);
    nostrStore.setSelectedTree(null);
  }, [npub]);

  if (!npub) return null;

  // For user route, show file browser on mobile, profile on desktop
  return (
    <>
      {/* File browser - always visible on mobile, sidebar on desktop */}
      <div className="flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col">
        <FileBrowser />
      </div>
      {/* Profile view - hidden on mobile, visible on desktop */}
      <div className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0">
        <ProfileView npub={npub} />
      </div>
    </>
  );
}

// Route: User's follows list
function FollowsRouteInner() {
  const { npub } = useParams<{ npub: string }>();

  useEffect(() => {
    if (!npub) return;
    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    appStore.setEntries([]);
    nostrStore.setSelectedTree(null);
  }, [npub]);

  if (!npub) return null;
  return <FollowsPage npub={npub} />;
}

// Route: User's profile (stacked on mobile, side-by-side on desktop)
function ProfileRouteInner() {
  const { npub } = useParams<{ npub: string }>();

  useEffect(() => {
    if (!npub) return;
    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    appStore.setEntries([]);
    nostrStore.setSelectedTree(null);
  }, [npub]);

  if (!npub) return null;

  return (
    <>
      {/* Desktop: side-by-side layout */}
      <div className="hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col">
        <FileBrowser />
      </div>
      <div className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0">
        <ProfileView npub={npub} />
      </div>

      {/* Mobile: stacked layout (profile on top, folders below) */}
      <div className="lg:hidden flex-1 overflow-y-auto">
        <ProfileView npub={npub} />
        <div className="border-t border-surface-3">
          <FileBrowser />
        </div>
      </div>
    </>
  );
}

// Route: Stream view within a tree
function StreamRouteInner() {
  const { npub, treeName } = useParams<{ npub: string; treeName: string }>();

  useEffect(() => {
    if (!npub || !treeName) return;
    loadFromNostr(npub, treeName, []);
  }, [npub, treeName]);

  if (!npub || !treeName) return null;

  return (
    <>
      {/* File browser - hidden on mobile, visible on desktop */}
      <div className="hidden lg:flex lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col">
        <FileBrowser key={`${npub}/${treeName}`} />
      </div>
      {/* Stream view */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <StreamView />
      </div>
    </>
  );
}

// Route: Tree view with optional path
function TreeRouteInner() {
  const { npub, treeName, '*': path } = useParams<{ npub: string; treeName: string; '*': string }>();
  const pathParts = path ? path.split('/').filter(Boolean).map(decodeURIComponent) : [];

  // Load tree from Nostr only when npub or treeName changes (not path)
  // Path changes within tree are handled by FileBrowser reading from store
  useEffect(() => {
    if (!npub || !treeName) return;
    loadFromNostr(npub, treeName, pathParts);
  }, [npub, treeName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!npub || !treeName) return null;

  return (
    <ExplorerLayout>
      <FileBrowser key={`${npub}/${treeName}`} />
    </ExplorerLayout>
  );
}

// Route: Direct hash navigation (no npub context)
// URL format: #/h/<64-char-hex>/<optional-path>
function HashRouteInner() {
  const { hash, '*': path } = useParams<{ hash: string; '*': string }>();
  const pathParts = path ? path.split('/').filter(Boolean).map(decodeURIComponent) : [];

  useEffect(() => {
    // Clear selectedTree - this is direct hash access
    useNostrStore.getState().setSelectedTree(null);

    if (hash && /^[a-f0-9]{64}$/i.test(hash)) {
      loadFromHash(hash, pathParts);
    }
  }, [hash, path]);

  return (
    <ExplorerLayout>
      <FileBrowser key={path || ''} />
    </ExplorerLayout>
  );
}

export function App() {
  const selectedTree = useNostrStore(s => s.selectedTree);
  const lastRootHashRef = useRef<string | null>(null);

  // Restore nostr session on mount
  useEffect(() => {
    restoreSession();
  }, []);

  // React to selectedTree updates (from nostr subscription)
  useEffect(() => {
    const handleTreeUpdate = async () => {
      if (selectedTree && selectedTree.rootHash) {
        if (lastRootHashRef.current !== null && lastRootHashRef.current !== selectedTree.rootHash) {
          const appState = useAppStore.getState();

          // Derive viewed file from URL + entries (selection is now URL-based)
          const hashPath = window.location.hash.slice(2); // Remove #/
          const pathParts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);
          // Skip npub/treeName or h/hash prefix (2 segments), rest is file path
          const filePath = pathParts.length >= 2 ? pathParts.slice(2) : [];

          // Derive current directory path from URL (exclude file if last segment is a file)
          const lastSegment = filePath[filePath.length - 1];
          const isLastSegmentFile = lastSegment && appState.entries.some(e => e.name === lastSegment && !e.isTree);
          const currentDirPath = isLastSegmentFile ? filePath.slice(0, -1) : filePath;
          const isViewingVideo = lastSegment && /\.(mp4|webm|ogg|mov)$/i.test(lastSegment);

          // Build map of old entry hashes before updating
          const oldHashes = new Map<string, string>();
          for (const e of appState.entries) {
            oldHashes.set(e.name, toHex(e.hash));
          }

          // If streaming or watching video, do a light update - just refresh entries without reloading content
          const isOnStreamRoute = pathParts[2] === 'stream';
          if (isOnStreamRoute || isViewingVideo) {
            await refreshTreeState(selectedTree.rootHash, currentDirPath);
          } else {
            await loadFromHash(selectedTree.rootHash, currentDirPath);
          }

          // Find all changed or new files and update recentlyChangedFiles
          const newEntries = useAppStore.getState().entries;
          const changedFiles = new Set<string>();
          for (const e of newEntries) {
            const oldHash = oldHashes.get(e.name);
            const newHash = toHex(e.hash);
            // Include both changed files (hash differs) and new files (no old hash)
            if (!oldHash || oldHash !== newHash) {
              changedFiles.add(e.name);
            }
          }

          if (changedFiles.size > 0) {
            markFilesChanged(changedFiles);
          }
        }
        lastRootHashRef.current = selectedTree.rootHash;
      } else {
        lastRootHashRef.current = null;
      }
    };
    handleTreeUpdate();
  }, [selectedTree]);

  return (
    <HashRouter>
      <div className="h-full flex flex-col bg-surface-0">
        {/* Top bar */}
        <header className="h-12 shrink-0 bg-surface-1 border-b border-surface-3 flex items-center justify-between px-3 md:px-4">
          <div className="flex items-center gap-2 md:gap-3">
            <AppMenu />
            <Link to="/" className="font-semibold text-text-1 no-underline">Hashtree</Link>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden md:block"><SearchInput /></div>
            <ConnectivityIndicator />
            <NostrLogin />
          </div>
        </header>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Routes */}
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/h/:hash/*" element={<HashRouteInner />} />
              <Route path="/h/:hash" element={<HashRouteInner />} />
              <Route path="/:npub/follows" element={<FollowsRouteInner />} />
              <Route path="/:npub/edit" element={<EditProfilePage />} />
              <Route path="/:npub/profile" element={<ProfileRouteInner />} />
              <Route path="/:npub/:treeName/stream" element={<StreamRouteInner />} />
              <Route path="/:npub/:treeName/*" element={<TreeRouteInner />} />
              <Route path="/:npub" element={<UserRouteInner />} />
              <Route path="/" element={<HomeRoute />} />
            </Routes>
          </div>
        </div>

        <CreateModal />
        <RenameModal />
      </div>
    </HashRouter>
  );
}

async function loadFromNostr(npubStr: string, treeName: string, pathParts: string[]) {
  try {
    // Resolve the tree's root hash via resolver
    const { getRefResolver, getResolverKey } = await import('./refResolver');
    const resolver = getRefResolver();
    const key = getResolverKey(npubStr, treeName);

    if (key) {
      const rootHash = await resolver.resolve(key);
      if (rootHash) {
        const { toHex } = await import('hashtree');
        const rootHashHex = toHex(rootHash);

        // Set selectedTree so live updates work
        const pubkey = npubToPubkey(npubStr);
        if (pubkey) {
          useNostrStore.getState().setSelectedTree({
            name: treeName,
            pubkey,
            rootHash: rootHashHex,
            created_at: Math.floor(Date.now() / 1000),
          });
        }

        await loadFromHash(rootHashHex, pathParts);

        // Subscribe to live updates via resolver
        resolver.subscribe(key, (hash) => {
          if (hash) {
            const hashHex = toHex(hash);
            const currentSelected = useNostrStore.getState().selectedTree;
            if (currentSelected && currentSelected.name === treeName) {
              useNostrStore.getState().setSelectedTree({
                ...currentSelected,
                rootHash: hashHex,
              });
            }
          }
        });
      }
    }
  } catch (e) {
    console.error('Failed to load from nostr:', e);
  }
}

// Helper to convert npub to pubkey
function npubToPubkey(npubStr: string): string | null {
  try {
    const { type, data } = nip19.decode(npubStr);
    if (type === 'npub') return data as string;
  } catch {}
  return null;
}

// Light refresh - updates rootHash and entries without triggering content reload
async function refreshTreeState(rootHex: string, pathParts: string[]) {
  try {
    const hash = fromHex(rootHex);
    const tree = getTree();
    const appStore = useAppStore.getState();

    appStore.setRootHash(hash);

    // Navigate to current directory
    let dirHash = hash;
    for (const part of pathParts) {
      const resolved = await tree.resolvePath(dirHash, part);
      if (resolved && await tree.isDirectory(resolved)) {
        dirHash = resolved;
      } else {
        break;
      }
    }

    // Update entries list
    const list = await tree.listDirectory(dirHash);
    appStore.setEntries(list);
  } catch {
    // Hash not in store
  }
}

async function loadFromHash(rootHex: string, pathParts: string[]) {
  try {
    const hash = fromHex(rootHex);
    const tree = getTree();
    const appStore = useAppStore.getState();

    // Check if the root hash is a file (not a directory)
    const isDir = await tree.isDirectory(hash);
    if (!isDir) {
      // Direct file hash - display the file directly
      appStore.setRootHash(hash);
      appStore.setEntries([]);
      return;
    }

    appStore.setRootHash(hash);

    // Navigate to the directory specified by pathParts
    let dirHash = hash;
    for (const part of pathParts) {
      const resolved = await tree.resolvePath(dirHash, part);
      if (!resolved) break;
      if (await tree.isDirectory(resolved)) {
        dirHash = resolved;
      } else {
        // Reached a file - stop at parent directory
        break;
      }
    }

    const list = await tree.listDirectory(dirHash);
    appStore.setEntries(list);
  } catch {
    // Hash not in store
  }
}
