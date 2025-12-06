/**
 * CopyText - clickable text with copy icon that copies to clipboard
 */
import { useState, useCallback } from 'react';

interface CopyTextProps {
  text: string;
  displayText?: string;
  truncate?: number;
  className?: string;
}

export function CopyText({ text, displayText, truncate, className = '' }: CopyTextProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }, [text]);

  // Determine what to display
  let display = displayText ?? text;
  if (truncate && display.length > truncate) {
    const half = Math.floor((truncate - 3) / 2);
    display = display.slice(0, half) + '...' + display.slice(-half);
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline text-text-2 hover:text-text-1 bg-transparent border-none cursor-pointer p-0 text-left ${className}`}
      title="Copy"
    >
      {copied ? (
        <span className="i-lucide-check text-success text-xs mr-1 inline-block align-middle" />
      ) : (
        <span className="i-lucide-copy text-xs mr-1 inline-block align-middle" />
      )}
      <span className="font-mono break-all">{display}</span>
    </button>
  );
}
