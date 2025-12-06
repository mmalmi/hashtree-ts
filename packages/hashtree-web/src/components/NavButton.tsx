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
      className={`btn-ghost ${className}`}
      title={title}
      disabled={disabled}
    >
      <span className={`${iconClass} text-base`} />
    </button>
  );
}
