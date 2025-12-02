import { useState, ChangeEvent, KeyboardEvent } from 'react';
import { nhashEncode, isNHash, isNPath } from 'hashtree';

// Match 64 hex chars optionally followed by /filename
const HASH_PATTERN = /^([a-f0-9]{64})(\/.*)?$/i;

export function SearchInput() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

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
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted shrink-0"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="npub or hash..."
        className="bg-transparent border-none outline-none text-sm text-text-1 placeholder:text-muted w-24 lg:w-36"
      />
    </div>
  );
}
