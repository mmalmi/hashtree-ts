import { useState, useEffect, useRef, useMemo, ChangeEvent, KeyboardEvent } from 'react';
import { nhashEncode, isNHash, isNPath } from 'hashtree';
import { nip19 } from 'nostr-tools';
import Fuse from 'fuse.js';
import { useNostrStore } from '../nostr';
import { useFollows } from '../utils/socialGraph';
import { UserRow } from './user/UserRow';

// Match 64 hex chars optionally followed by /filename
const HASH_PATTERN = /^([a-f0-9]{64})(\/.*)?$/i;

interface SearchResult {
  pubkey: string;
  npub: string;
}

function useSearchNavigation() {
  const [value, setValue] = useState('');

  const navigate = (input: string) => {
    let trimmed = input.trim();

    // Extract hash fragment from full URL (e.g. https://example.com/#/npub1...)
    try {
      const url = new URL(trimmed);
      if (url.hash) {
        trimmed = url.hash.slice(1); // Remove leading #
        if (trimmed.startsWith('/')) trimmed = trimmed.slice(1);
      }
    } catch {
      // Not a URL, continue with original input
    }

    // npub
    if (trimmed.startsWith('npub1') && trimmed.length >= 63) {
      window.location.hash = `#/${trimmed}`;
      setValue('');
      return true;
    }

    // nhash or npath - navigate directly
    if (isNHash(trimmed) || isNPath(trimmed)) {
      window.location.hash = `#/${trimmed}`;
      setValue('');
      return true;
    }

    // Hex hash with optional path - convert to nhash format
    const hashMatch = trimmed.match(HASH_PATTERN);
    if (hashMatch) {
      const hash = hashMatch[1];
      const path = hashMatch[2] || '';
      const nhash = nhashEncode(hash);
      window.location.hash = `#/${nhash}${path}`;
      setValue('');
      return true;
    }

    // Route path (e.g. npub1.../treename)
    if (trimmed.startsWith('npub1')) {
      window.location.hash = `#/${trimmed}`;
      setValue('');
      return true;
    }

    return false;
  };

  return { value, setValue, navigate };
}

/** Hook to create fuse.js index from followed users */
function useUserSearchIndex() {
  const userPubkey = useNostrStore(s => s.pubkey);
  const follows = useFollows(userPubkey);

  return useMemo(() => {
    if (!follows || follows.size === 0) return null;

    const searchItems: SearchResult[] = [];
    for (const pubkey of follows) {
      try {
        const npub = nip19.npubEncode(pubkey);
        searchItems.push({ pubkey, npub });
      } catch {
        // Skip invalid pubkeys
      }
    }

    return new Fuse(searchItems, {
      keys: ['npub', 'pubkey'],
      includeScore: true,
      threshold: 0.4,
    });
  }, [follows]);
}

export function SearchInput() {
  const { value, setValue, navigate } = useSearchNavigation();
  const [focused, setFocused] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const fuseIndex = useUserSearchIndex();

  // Search results
  const searchResults = useMemo(() => {
    if (!fuseIndex || !value.trim() || value.trim().length < 2) return [];
    const results = fuseIndex.search(value.trim(), { limit: 5 });
    return results.map(r => r.item);
  }, [fuseIndex, value]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = (result: SearchResult) => {
    window.location.hash = `#/${result.npub}`;
    setValue('');
    setShowDropdown(false);
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    // Auto-navigate on paste if valid
    if (!navigate(newValue)) {
      setValue(e.target.value);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && searchResults[selectedIndex]) {
        e.preventDefault();
        handleSelectUser(searchResults[selectedIndex]);
        return;
      }
    }
    if (e.key === 'Enter') {
      navigate(value.trim());
      setShowDropdown(false);
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border transition-colors ${focused ? 'border-accent' : 'border-surface-3'}`}>
        <span className="i-lucide-search text-sm text-muted shrink-0" />
        <input
          type="text"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => { setFocused(true); setShowDropdown(true); }}
          onBlur={() => setFocused(false)}
          placeholder="Search users or paste hash..."
          className="bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted w-40 lg:w-64"
        />
      </div>

      {/* Search results dropdown */}
      {showDropdown && searchResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 rounded border border-surface-3 shadow-lg z-50 max-h-64 overflow-auto">
          {searchResults.map((result, index) => (
            <button
              key={result.pubkey}
              onClick={() => handleSelectUser(result)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full px-3 py-2 text-left ${index === selectedIndex ? 'bg-surface-3' : 'hover:bg-surface-3'}`}
            >
              <UserRow pubkey={result.pubkey} avatarSize={28} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Mobile search - shows icon button, expands to full header search on click
export function MobileSearch() {
  const [expanded, setExpanded] = useState(false);
  const { value, setValue, navigate } = useSearchNavigation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fuseIndex = useUserSearchIndex();

  // Search results
  const searchResults = useMemo(() => {
    if (!fuseIndex || !value.trim() || value.trim().length < 2) return [];
    const results = fuseIndex.search(value.trim(), { limit: 5 });
    return results.map(r => r.item);
  }, [fuseIndex, value]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = (result: SearchResult) => {
    window.location.hash = `#/${result.npub}`;
    setValue('');
    setExpanded(false);
    setShowDropdown(false);
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    if (!navigate(newValue)) {
      setValue(e.target.value);
      setShowDropdown(true);
    } else {
      setExpanded(false);
      setShowDropdown(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && searchResults[selectedIndex]) {
        e.preventDefault();
        handleSelectUser(searchResults[selectedIndex]);
        return;
      }
    }
    if (e.key === 'Enter') {
      if (navigate(value.trim())) {
        setExpanded(false);
        setShowDropdown(false);
      }
    } else if (e.key === 'Escape') {
      setExpanded(false);
      setValue('');
      setShowDropdown(false);
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-text-2 hover:text-text-1 bg-transparent border-none cursor-pointer md:hidden"
        title="Search"
      >
        <span className="i-lucide-search" />
      </button>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0 flex items-center px-3 bg-surface-1 z-10 md:hidden">
      <div className="flex-1 relative">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-accent">
          <span className="i-lucide-search text-sm text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search users or paste hash..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted"
          />
        </div>

        {/* Search results dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 rounded border border-surface-3 shadow-lg z-50 max-h-64 overflow-auto">
            {searchResults.map((result, index) => (
              <button
                key={result.pubkey}
                onClick={() => handleSelectUser(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full px-3 py-2 text-left ${index === selectedIndex ? 'bg-surface-3' : 'hover:bg-surface-3'}`}
              >
                <UserRow pubkey={result.pubkey} avatarSize={28} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => { setExpanded(false); setValue(''); setShowDropdown(false); }}
        className="ml-2 text-text-2 hover:text-text-1 bg-transparent border-none cursor-pointer"
      >
        <span className="i-lucide-x" />
      </button>
    </div>
  );
}
