import { create } from 'zustand';
import { navigate } from '../utils/navigate';
import { useNostrStore, logout } from '../nostr';

// Drawer state store
interface DrawerState {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const useDrawerStore = create<DrawerState>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));

// Legacy export for compatibility
export const drawerOpen = {
  get value() { return useDrawerStore.getState().drawerOpen; },
  set value(v: boolean) { useDrawerStore.getState().setDrawerOpen(v); },
};

export function AppMenu() {
  const isDrawerOpen = useDrawerStore(s => s.drawerOpen);
  const setDrawerOpen = useDrawerStore(s => s.setDrawerOpen);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);

  const close = () => { setDrawerOpen(false); };

  const handleLogout = () => {
    logout();
    close();
  };

  const handleOpenSettings = () => {
    navigate('/settings');
    close();
  };

  const handleOpenWallet = () => {
    navigate('/wallet');
    close();
  };

  return (
    <>
      {/* Menu button */}
      <button
        onClick={() => { setDrawerOpen(true); }}
        className="bg-transparent border-none text-text-1 cursor-pointer p-1 hover:bg-surface-2 rounded"
      >
        <span className="i-lucide-menu text-xl" />
      </button>

      {/* Backdrop */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50"
          onClick={close}
        />
      )}

      {/* Drawer */}
      <div className={`
        fixed top-0 left-0 h-full w-72 bg-surface-1 z-50
        transform transition-transform duration-200 ease-out
        ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full'}
        flex flex-col shadow-xl
      `}>
        {/* Header */}
        <div className="h-12 px-4 flex items-center border-b border-surface-3">
          <span className="font-semibold text-text-1">Hashtree</span>
        </div>

        {/* Menu items */}
        <nav className="flex-1 py-2 overflow-y-auto">
          <MenuItem icon="i-lucide-wallet" label="Wallet" onClick={handleOpenWallet} />
          <MenuItem icon="i-lucide-settings" label="Settings" onClick={handleOpenSettings} />

          {isLoggedIn && (
            <>
              <div className="border-t border-surface-3 my-2" />
              <MenuItem icon="i-lucide-log-out" label="Logout" onClick={handleLogout} danger />
            </>
          )}
        </nav>
      </div>
    </>
  );
}

function MenuItem({ icon, label, onClick, danger }: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-4 px-6 py-3 text-sm
        hover:bg-surface-2 cursor-pointer bg-transparent border-none text-left
        ${danger ? 'text-danger' : 'text-text-1'}
      `}
    >
      <span className={`${icon} text-lg opacity-70`} />
      <span>{label}</span>
    </button>
  );
}
