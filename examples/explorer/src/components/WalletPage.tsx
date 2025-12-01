import { navigate } from '../utils/navigate';
import { WalletPanel } from './WalletPanel';

export function WalletPage() {
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
        <span className="font-semibold text-text-1">Wallet</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto">
          <WalletPanel />
        </div>
      </div>
    </div>
  );
}
