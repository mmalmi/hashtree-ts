import { useState } from 'react';
import { navigate } from '../utils/navigate';
import {
  useNostrStore,
  loginWithExtension,
  loginWithNsec,
  generateNewKey,
} from '../nostr';
import { Avatar } from './user';

export function NostrLogin() {
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);
  const npub = useNostrStore(s => s.npub);
  const pubkey = useNostrStore(s => s.pubkey);

  const [showNsec, setShowNsec] = useState(false);
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState('');

  const goToProfile = () => {
    if (!npub) return;
    navigate(`/${npub}/profile`);
  };

  const handleExtensionLogin = async () => {
    setError('');
    const success = await loginWithExtension();
    if (!success) {
      setError('Extension login failed. Is a nostr extension installed?');
    }
  };

  const handleNsecLogin = () => {
    setError('');
    if (!nsecInput.trim()) {
      setError('Please enter an nsec');
      return;
    }
    const success = loginWithNsec(nsecInput.trim());
    if (!success) {
      setError('Invalid nsec');
    } else {
      setNsecInput('');
      setShowNsec(false);
    }
  };

  const handleGenerate = () => {
    setError('');
    generateNewKey();
  };

  // Logged in: just show avatar that links to profile (double-click for accounts)
  if (isLoggedIn && pubkey) {
    return (
      <button
        onClick={goToProfile}
        onDoubleClick={() => navigate('/users')}
        className="bg-transparent border-none cursor-pointer p-0 hover:opacity-80"
        title="My Profile (double-click for users)"
      >
        <Avatar key={pubkey} pubkey={pubkey} size={32} />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 md:gap-2 flex-wrap">
        <button onClick={handleExtensionLogin} className="btn-success text-xs md:text-sm">
          <span className="hidden md:inline">Login (Extension)</span>
          <span className="md:hidden">Login</span>
        </button>

        <button
          onClick={() => setShowNsec(!showNsec)}
          className="btn-ghost text-xs md:text-sm hidden md:block"
        >
          {showNsec ? 'Cancel' : 'nsec'}
        </button>

        <button onClick={handleGenerate} className="btn-ghost text-xs md:text-sm hidden md:block">
          New
        </button>
      </div>

      {showNsec && (
        <div className="flex gap-2">
          <input
            type="password"
            value={nsecInput}
            onInput={(e) => setNsecInput((e.target as HTMLInputElement).value)}
            placeholder="nsec1..."
            className="flex-1 input text-sm"
          />
          <button onClick={handleNsecLogin} className="btn-success text-sm">
            Login
          </button>
        </div>
      )}

      {error && (
        <p className="text-danger text-sm m-0">{error}</p>
      )}
    </div>
  );
}
