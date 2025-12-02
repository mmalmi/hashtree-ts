export function Logo({ className = '', showBack = false }: { className?: string; showBack?: boolean }) {
  return (
    <span className={`logo-cyber ${className}`}>{showBack ? '<' : '#'} hashtree</span>
  );
}
