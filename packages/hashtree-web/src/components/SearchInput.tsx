import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { nhashEncode, isNHash, isNPath } from 'hashtree';

// Match 64 hex chars optionally followed by /filename
const HASH_PATTERN = /^([a-f0-9]{64})(\/.*)?$/i;

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

export function SearchInput() {
  const { value, setValue, navigate } = useSearchNavigation();
  const [focused, setFocused] = useState(false);

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    // Auto-navigate on paste if valid
    if (!navigate(newValue)) {
      setValue(e.target.value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate(value.trim());
    }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border transition-colors ${focused ? 'border-accent' : 'border-surface-3'}`}>
      <span className="i-lucide-search text-sm text-muted shrink-0" />
      <input
        type="text"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="npub or hash..."
        className="bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted w-40 lg:w-64"
      />
    </div>
  );
}

// Mobile search - shows icon button, expands to full header search on click
export function MobileSearch() {
  const [expanded, setExpanded] = useState(false);
  const { value, setValue, navigate } = useSearchNavigation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    if (!navigate(newValue)) {
      setValue(e.target.value);
    } else {
      setExpanded(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (navigate(value.trim())) {
        setExpanded(false);
      }
    } else if (e.key === 'Escape') {
      setExpanded(false);
      setValue('');
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
    <div className="absolute inset-0 flex items-center px-3 bg-surface-1 z-10 md:hidden">
      <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-accent">
        <span className="i-lucide-search text-sm text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="npub or hash..."
          className="flex-1 bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted"
        />
      </div>
      <button
        onClick={() => { setExpanded(false); setValue(''); }}
        className="ml-2 text-text-2 hover:text-text-1 bg-transparent border-none cursor-pointer"
      >
        <span className="i-lucide-x" />
      </button>
    </div>
  );
}
