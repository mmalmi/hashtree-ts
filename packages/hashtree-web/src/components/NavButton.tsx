/**
 * NavButton - navigation button (back, close) without background
 */

interface NavButtonProps {
  onClick: () => void;
  icon?: 'back' | 'close';
  title?: string;
  className?: string;
  disabled?: boolean;
}

export function NavButton({ onClick, icon = 'back', title, className = '', disabled }: NavButtonProps) {
  const iconClass = icon === 'close' ? 'i-lucide-x' : 'i-lucide-chevron-left';

  return (
    <button
      onClick={onClick}
      className={`bg-transparent border-none text-text-2 cursor-pointer p-1 hover:bg-surface-2 rounded disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      title={title}
      disabled={disabled}
    >
      <span className={`${iconClass} text-lg`} />
    </button>
  );
}
