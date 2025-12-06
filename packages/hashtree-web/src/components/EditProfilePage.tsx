import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { navigate } from '../utils/navigate';
import { useProfile, invalidateProfile } from '../hooks/useProfile';
import { useNostrStore, ndk } from '../nostr';
import { nip19 } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { NavButton } from './NavButton';

export function EditProfilePage() {
  const { npub } = useParams<{ npub: string }>();
  const myPubkey = useNostrStore(s => s.pubkey);
  const isLoggedIn = useNostrStore(s => s.isLoggedIn);

  const pubkeyHex = (() => {
    if (!npub) return '';
    try {
      const decoded = nip19.decode(npub);
      return decoded.data as string;
    } catch {
      return '';
    }
  })();

  const isOwnProfile = myPubkey === pubkeyHex;
  const profile = useProfile(npub);

  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [picture, setPicture] = useState('');
  const [banner, setBanner] = useState('');
  const [website, setWebsite] = useState('');
  const [nip05, setNip05] = useState('');
  const [lud16, setLud16] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Populate form when profile loads
  useEffect(() => {
    if (profile) {
      setName(profile.name || profile.display_name || '');
      setAbout(profile.about || '');
      setPicture(profile.picture || '');
      setBanner(profile.banner || '');
      setWebsite(profile.website || '');
      setNip05(profile.nip05 || '');
      setLud16(profile.lud16 || '');
    }
  }, [profile]);

  // Redirect if not own profile
  useEffect(() => {
    if (pubkeyHex && myPubkey && !isOwnProfile) {
      navigate(`/${npub}`);
    }
  }, [pubkeyHex, myPubkey, isOwnProfile, npub]);

  if (!isLoggedIn || !isOwnProfile) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0">
        <div className="text-text-2">Not authorized</div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const profileData = {
        name,
        display_name: name,
        about,
        picture,
        banner,
        website,
        nip05,
        lud16,
      };

      // Remove empty fields
      const cleanedProfile = Object.fromEntries(
        Object.entries(profileData).filter(([, v]) => v)
      );

      const event = new NDKEvent(ndk);
      event.kind = 0;
      event.content = JSON.stringify(cleanedProfile);

      await event.publish();

      // Invalidate cache and refetch - small delay to let relays propagate
      setTimeout(() => {
        invalidateProfile(pubkeyHex);
      }, 500);

      // Navigate back to profile
      navigate(`/${npub}`);
    } catch (e) {
      console.error('Failed to save profile:', e);
      setError('Failed to save profile');
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate(`/${npub}`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-1 border-b border-surface-3 px-4 py-3 flex items-center gap-3">
        <NavButton onClick={handleCancel} disabled={saving} />
        <h1 className="text-lg font-semibold flex-1">Edit Profile</h1>
        <button
          onClick={handleSave}
          className="btn-success"
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Form */}
      <div className="p-4 flex flex-col gap-4 max-w-lg mx-auto w-full">
        {error && (
          <div className="text-danger text-sm bg-danger/10 p-3 rounded">{error}</div>
        )}

        <div>
          <label className="text-sm text-text-2 block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">About</label>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Tell us about yourself"
            rows={4}
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1 resize-none"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">Profile Picture URL</label>
          <input
            type="url"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            placeholder="https://..."
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">Banner URL</label>
          <input
            type="url"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="https://..."
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">Website</label>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://..."
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">NIP-05</label>
          <input
            type="text"
            value={nip05}
            onChange={(e) => setNip05(e.target.value)}
            placeholder="you@example.com"
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        <div>
          <label className="text-sm text-text-2 block mb-1">Lightning Address</label>
          <input
            type="text"
            value={lud16}
            onChange={(e) => setLud16(e.target.value)}
            placeholder="you@getalby.com"
            className="w-full p-3 rounded bg-surface-2 border border-surface-3 text-text-1"
          />
        </div>

        {/* Bottom padding for mobile */}
        <div className="h-8" />
      </div>
    </div>
  );
}
