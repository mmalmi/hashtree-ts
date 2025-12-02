import { useEffect, useRef, useState, useMemo } from 'react';
import { HashRouter, Routes, Route, useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { toHex, fromHex, nhashDecode, npathDecode, isNHash, isNPath } from 'hashtree';
import {
  FileBrowser,
  Preview,
  CreateModal,
  RenameModal,
  ForkModal,
  NostrLogin,
  ConnectivityIndicator,
  SearchInput,
  SettingsPage,
  WalletPage,
  ProfileView,
  FollowsPage,
  StreamView,
  Logo,
  RecentsView,
} from './components';
import { EditProfilePage } from './components/EditProfilePage';
import {
  useAppStore,
  getTree,
} from './store';
import { markFilesChanged } from './hooks/useRecentlyChanged';
import { nip19 } from 'nostr-tools';
import { useNostrStore } from './nostr';
import { useSelectedFile, useRoute, addRecent } from './hooks';
import { useWalletStore, initWallet } from './wallet';

// Wallet link with balance
function WalletLink() {
  const balances = useWalletStore(s => s.balances);
  const totalBalance = useMemo(() => Object.values(balances).reduce((sum, b) => sum + b, 0), [balances]);

  // Initialize wallet on mount
  useEffect(() => {
    initWallet();
  }, []);

  return (
    <Link to="/wallet" className="flex flex-col items-center text-text-2 hover:text-text-1 p-1 no-underline">
      <span className="i-lucide-wallet text-base" />
      <span className="text-[10px] leading-none">{totalBalance}</span>
    </Link>
  );
}

// Logo link that clears fullscreen mode when clicked
function LogoLink() {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isFullscreen = searchParams.get('fullscreen') === '1';

  const handleClick = (e: React.MouseEvent) => {
    if (isFullscreen) {
      e.preventDefault();
      // Clear fullscreen param, keep the rest of the URL
      const hash = window.location.hash.split('?')[0];
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      params.delete('fullscreen');
      const queryString = params.toString();
      window.location.hash = queryString ? `${hash}?${queryString}` : hash;
    }
  };

  return (
    <Link to="/" onClick={handleClick} className="no-underline">
      <Logo />
    </Link>
  );
}

// Shared layout wrapper - uses URL-derived selection to show/hide on mobile
function ExplorerLayout({ children }: { children: React.ReactNode }) {
  // Use URL path to determine if file is selected - more stable than entries-based detection
  // This prevents layout shifts during merkle root updates when entries change
  const route = useRoute();
  const location = useLocation();
  const hasFileSelected = route.path.length > 0;

  // Check for fullscreen mode from URL query param
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isFullscreen = searchParams.get('fullscreen') === '1';

  // In fullscreen mode, hide file browser entirely
  if (isFullscreen) {
    return (
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <Preview />
      </div>
    );
  }

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
// Redirects newly generated users to their home folder, shows recents for returning users
function HomeRoute() {
  const navigate = useNavigate();
  const npub = useNostrStore(s => s.npub);
  const isNewUser = useNostrStore(s => s.isNewUser);

  useEffect(() => {
    // Redirect newly generated users to their home folder
    if (npub && isNewUser) {
      useNostrStore.getState().setIsNewUser(false);
      navigate(`/${npub}/home`, { replace: true });
      return;
    }

    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    nostrStore.setSelectedTree(null);
  }, [npub, isNewUser, navigate]);

  // Show FileBrowser on left, RecentsView on right (desktop) or just FileBrowser (mobile)
  return (
    <>
      <div className="flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col">
        <FileBrowser />
      </div>
      <div className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0 bg-surface-0">
        <RecentsView />
      </div>
    </>
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

    // Track as recent
    addRecent({
      type: 'tree',
      label: treeName,
      path: `/${npub}/${treeName}`,
      npub,
      treeName,
    });
  }, [npub, treeName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!npub || !treeName) return null;

  return (
    <ExplorerLayout>
      <FileBrowser key={`${npub}/${treeName}`} />
    </ExplorerLayout>
  );
}

// Route: Handles npub (user view), nhash (permalink), or npath (live reference)
// Distinguishes by prefix: npub1... vs nhash1... vs npath1...
// For nhash, path comes from URL segments: /nhash1.../path/to/file
function NpubOrNHashOrNPathRoute() {
  const { id, '*': path } = useParams<{ id: string; '*': string }>();

  // Check if it's an nhash (permalink) - path comes from URL segments
  if (id && isNHash(id)) {
    return <NHashView nhash={id} />;
  }

  // Check if it's an npath (live reference)
  if (id && isNPath(id)) {
    return <NPathView npath={id} />;
  }

  // Otherwise treat as npub (UserRouteInner behavior)
  return <UserView npub={id} />;
}

// nhash view - displays directory/file by hash (path in URL segments: /nhash1.../path/to/file)
function NHashView({ nhash }: { nhash: string }) {
  useEffect(() => {
    useNostrStore.getState().setSelectedTree(null);

    try {
      const decoded = nhashDecode(nhash);
      loadFromHash(decoded.hash);
    } catch {
      // Invalid nhash
    }
  }, [nhash]);

  try {
    nhashDecode(nhash); // Validate
    return (
      <ExplorerLayout>
        <FileBrowser key={nhash} />
      </ExplorerLayout>
    );
  } catch {
    return <div className="p-4 text-muted">Invalid nhash format</div>;
  }
}

// npath view - redirects to npub/tree/path URL format
function NPathView({ npath }: { npath: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const decoded = npathDecode(npath);
      // Convert pubkey to npub
      const npub = nip19.npubEncode(decoded.pubkey);
      // Build URL path: /npub/treeName/path...
      const parts = [npub, decoded.treeName, ...decoded.path];
      const url = '/' + parts.map(encodeURIComponent).join('/');
      // Replace current history entry (don't add npath to history)
      navigate(url, { replace: true });
    } catch {
      // Invalid npath - navigate home
      navigate('/', { replace: true });
    }
  }, [npath, navigate]);

  // Show loading while redirecting
  return <div className="p-4 text-muted">Loading...</div>;
}

// User view (from UserRouteInner)
function UserView({ npub }: { npub: string | undefined }) {
  useEffect(() => {
    if (!npub) return;
    const appStore = useAppStore.getState();
    const nostrStore = useNostrStore.getState();

    appStore.setRootHash(null);
    nostrStore.setSelectedTree(null);
  }, [npub]);

  if (!npub) return null;

  return (
    <>
      <div className="flex flex-1 lg:flex-none lg:w-80 shrink-0 lg:border-r border-surface-3 flex-col">
        <FileBrowser />
      </div>
      <div className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0">
        <ProfileView npub={npub} />
      </div>
    </>
  );
}

export function App() {
  const selectedTree = useNostrStore(s => s.selectedTree);
  const lastRootHashRef = useRef<string | null>(null);

  // React to selectedTree updates (from nostr subscription)
  useEffect(() => {
    const handleTreeUpdate = async () => {
      if (selectedTree && selectedTree.rootHash) {
        const isNewRootHash = lastRootHashRef.current !== null && lastRootHashRef.current !== selectedTree.rootHash;

        if (isNewRootHash) {
          // Derive viewed file from URL (selection is now URL-based)
          const hashPath = window.location.hash.slice(2); // Remove #/
          const pathParts = hashPath.split('/').filter(Boolean).map(decodeURIComponent);
          // Skip npub/treeName or h/hash prefix (2 segments), rest is file path
          const filePath = pathParts.length >= 2 ? pathParts.slice(2) : [];

          // Derive current directory path from URL (exclude file if last segment looks like a file)
          const lastSegment = filePath[filePath.length - 1];
          const looksLikeFile = lastSegment && /\.[a-zA-Z0-9]+$/.test(lastSegment);
          const currentDirPath = looksLikeFile ? filePath.slice(0, -1) : filePath;

          // Fetch old entries before update for LIVE indicator comparison
          const tree = getTree();
          const oldRootHash = fromHex(lastRootHashRef.current!);
          let oldDirHash = oldRootHash;
          for (const part of currentDirPath) {
            const resolved = await tree.resolvePath(oldDirHash, part);
            if (resolved) oldDirHash = resolved;
            else break;
          }
          const oldEntries = await tree.listDirectory(oldDirHash).catch(() => []);

          // Build map of old entry hashes
          const oldHashes = new Map<string, string>();
          for (const e of oldEntries) {
            oldHashes.set(e.name, toHex(e.hash));
          }

          // Update rootHash
          loadFromHash(selectedTree.rootHash);

          // Fetch new entries to compare
          const newRootHash = fromHex(selectedTree.rootHash);
          let newDirHash = newRootHash;
          for (const part of currentDirPath) {
            const resolved = await tree.resolvePath(newDirHash, part);
            if (resolved) newDirHash = resolved;
            else break;
          }
          const newEntries = await tree.listDirectory(newDirHash).catch(() => []);

          // Find all changed or new files and update recentlyChangedFiles
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
            <LogoLink />
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden md:block"><SearchInput /></div>
            <ConnectivityIndicator />
            <WalletLink />
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
              {/* User/profile routes (npub) */}
              <Route path="/:npub/follows" element={<FollowsRouteInner />} />
              <Route path="/:npub/edit" element={<EditProfilePage />} />
              <Route path="/:npub/profile" element={<ProfileRouteInner />} />
              <Route path="/:npub/:treeName/stream" element={<StreamRouteInner />} />
              <Route path="/:npub/:treeName/*" element={<TreeRouteInner />} />
              {/* Catch-all for npub user view, nhash permalink (with optional path), or npath live reference */}
              <Route path="/:id/*" element={<NpubOrNHashOrNPathRoute />} />
              <Route path="/:id" element={<NpubOrNHashOrNPathRoute />} />
              <Route path="/" element={<HomeRoute />} />
            </Routes>
          </div>
        </div>

        <CreateModal />
        <RenameModal />
        <ForkModal />
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
            id: '', // Will be set by actual nostr event
            name: treeName,
            pubkey,
            rootHash: rootHashHex,
            created_at: Math.floor(Date.now() / 1000),
          });
        }

        loadFromHash(rootHashHex);

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

// Set rootHash - hooks will re-fetch entries automatically
function loadFromHash(rootHex: string) {
  try {
    const hash = fromHex(rootHex);
    useAppStore.getState().setRootHash(hash);
  } catch {
    // Hash not in store
  }
}
