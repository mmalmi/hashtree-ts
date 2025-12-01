import { Avatar } from './Avatar';
import { Name } from './Name';

interface Props {
  pubkey: string;
  description?: string;
  avatarSize?: number;
  class?: string;
  className?: string;
}

/**
 * User row with avatar and name
 */
export function UserRow({ pubkey, description, avatarSize = 36, class: classProp, className }: Props) {
  const cssClass = classProp || className;
  return (
    <div className={`flex items-center gap-3 ${cssClass || ''}`}>
      <Avatar pubkey={pubkey} size={avatarSize} />
      <div className="flex flex-col min-w-0">
        <Name pubkey={pubkey} className="text-sm" />
        {description && (
          <span className="text-xs text-muted truncate">{description}</span>
        )}
      </div>
    </div>
  );
}
