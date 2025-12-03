import { useState } from 'react';
import { Link } from 'react-router-dom';
import { navigate } from '../utils/navigate';
import { Avatar, Name } from './user';
import { useNostrStore, loginWithNsec, loginWithExtension, generateNewKey } from '../nostr';
import {
  useAccountsStore,
  createAccountFromNsec,
  createExtensionAccount,
  hasExtensionAccount,
  hasNostrExtension,
  saveActiveAccountToStorage,
  type Account,
} from '../accounts';

export function AccountsPage() {
  const myPubkey = useNostrStore(s => s.pubkey);
  const myNpub = useNostrStore(s => s.npub);
  const accounts = useAccountsStore(s => s.accounts);
  const addAccount = useAccountsStore(s => s.addAccount);
  const removeAccount = useAccountsStore(s => s.removeAccount);
  const setActiveAccount = useAccountsStore(s => s.setActiveAccount);

  const [showAddNsec, setShowAddNsec] = useState(false);
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);

  const handleAddNsec = () => {
    setError('');
    const trimmed = nsecInput.trim();
    if (!trimmed) {
      setError('Please enter an nsec');
      return;
    }

    const account = createAccountFromNsec(trimmed);
    if (!account) {
      setError('Invalid nsec');
      return;
    }

    // Check if already exists
    if (accounts.some(a => a.pubkey === account.pubkey)) {
      setError('Account already added');
      return;
    }

    addAccount(account);
    setNsecInput('');
    setShowAddNsec(false);
  };

  const handleAddExtension = async () => {
    setError('');

    if (!hasNostrExtension()) {
      setError('No nostr extension found');
      return;
    }

    if (hasExtensionAccount()) {
      setError('Extension account already added');
      return;
    }

    try {
      // Get pubkey from extension
      const pubkey = await window.nostr!.getPublicKey();
      const account = createExtensionAccount(pubkey);

      // Check if already exists (as nsec account)
      if (accounts.some(a => a.pubkey === account.pubkey)) {
        setError('Account already added');
        return;
      }

      addAccount(account);
    } catch {
      setError('Failed to get pubkey from extension');
    }
  };

  const handleGenerateNew = () => {
    setError('');
    // generateNewKey creates a new keypair, sets it active, and adds to accounts store
    generateNewKey();
  };

  const handleSwitchAccount = async (account: Account) => {
    if (account.pubkey === myPubkey) return;

    setSwitching(account.pubkey);
    setError('');

    try {
      let success = false;

      if (account.type === 'extension') {
        success = await loginWithExtension();
      } else if (account.nsec) {
        success = loginWithNsec(account.nsec, false); // Don't save again, already in accounts
      }

      if (success) {
        setActiveAccount(account.pubkey);
        saveActiveAccountToStorage(account.pubkey);
      } else {
        setError('Failed to switch account');
      }
    } catch {
      setError('Failed to switch account');
    } finally {
      setSwitching(null);
    }
  };

  const handleRemoveAccount = (account: Account) => {
    if (accounts.length <= 1) {
      setError('Cannot remove the only account');
      return;
    }

    const removed = removeAccount(account.pubkey);
    if (!removed) {
      setError('Cannot remove the only account');
    } else if (account.pubkey === myPubkey && accounts.length > 1) {
      // If removing current account, switch to another
      const nextAccount = accounts.find(a => a.pubkey !== account.pubkey);
      if (nextAccount) {
        handleSwitchAccount(nextAccount);
      }
    }
  };

  const handleBack = () => {
    if (myNpub) {
      navigate(`/${myNpub}`);
    } else {
      navigate('/');
    }
  };

  const canShowExtensionOption = hasNostrExtension() && !hasExtensionAccount();

  return (
    <div className="flex-1 flex flex-col bg-surface-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-surface-3">
        <button
          onClick={handleBack}
          className="btn-ghost p-2"
          title="Back"
        >
          <span className="i-lucide-arrow-left text-lg" />
        </button>
        <h1 className="text-xl font-bold text-text-1 m-0">Accounts</h1>
      </div>

      {/* Account List */}
      <div className="p-4">
        <div className="flex flex-col gap-2">
          {accounts.map(account => (
            <AccountRow
              key={account.pubkey}
              account={account}
              isActive={account.pubkey === myPubkey}
              isSwitching={switching === account.pubkey}
              canRemove={accounts.length > 1}
              onSwitch={() => handleSwitchAccount(account)}
              onRemove={() => handleRemoveAccount(account)}
            />
          ))}
        </div>

        {accounts.length === 0 && (
          <div className="text-center text-text-2 py-8">
            No accounts added yet
          </div>
        )}

        {/* Add Account */}
        {error && (
          <div className="text-danger text-sm mt-3">{error}</div>
        )}

        <div className="flex flex-col gap-2 mt-4">
          <button
            onClick={handleGenerateNew}
            className="btn-success"
          >
            Generate new
          </button>

          <div className="flex gap-2">
            {canShowExtensionOption && (
              <button
                onClick={handleAddExtension}
                className="btn-ghost flex-1"
              >
                Add from Extension
              </button>
            )}

            {!showAddNsec ? (
              <button
                onClick={() => setShowAddNsec(true)}
                className="btn-ghost flex-1"
              >
                Add with nsec
              </button>
            ) : (
            <div className="flex flex-col gap-2 flex-1">
              <input
                type="password"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                placeholder="nsec1..."
                className="input w-full"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddNsec(false);
                    setNsecInput('');
                    setError('');
                  }}
                  className="btn-ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNsec}
                  className="btn-success flex-1"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AccountRowProps {
  account: Account;
  isActive: boolean;
  isSwitching: boolean;
  canRemove: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}

function AccountRow({ account, isActive, isSwitching, canRemove, onSwitch, onRemove }: AccountRowProps) {
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${isActive ? 'bg-surface-2' : 'bg-surface-1 hover:bg-surface-2'}`}>
      <Link to={`/${account.npub}`} className="shrink-0">
        <Avatar pubkey={account.pubkey} size={40} />
      </Link>
      <button
        onClick={onSwitch}
        disabled={isActive || isSwitching}
        className="flex items-center gap-3 flex-1 min-w-0 bg-transparent border-none cursor-pointer p-0 text-left disabled:cursor-default"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text-1 truncate">
            <Name pubkey={account.pubkey} />
          </div>
          <div className="text-xs text-text-2">
            {account.type === 'extension' ? 'Extension' : 'nsec'}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-2">
        {isSwitching && (
          <span className="i-lucide-loader-2 animate-spin text-text-2" />
        )}

        {isActive && (
          <span className="i-lucide-check-circle text-success" />
        )}

        {!isActive && !isSwitching && (
          <button
            onClick={onSwitch}
            className="btn-ghost p-2 text-sm"
            title="Switch to this account"
          >
            Switch
          </button>
        )}

        {canRemove && !showConfirmRemove && (
          <button
            onClick={() => setShowConfirmRemove(true)}
            className="btn-ghost p-2 text-text-2 hover:text-danger"
            title="Remove account"
          >
            <span className="i-lucide-trash-2" />
          </button>
        )}

        {showConfirmRemove && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowConfirmRemove(false)}
              className="btn-ghost p-1 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onRemove();
                setShowConfirmRemove(false);
              }}
              className="btn-ghost p-1 text-xs text-danger"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
