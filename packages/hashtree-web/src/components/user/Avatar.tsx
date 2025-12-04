import { useState, useEffect } from 'react';
import { useProfile, getProfileName } from '../../hooks/useProfile';
import { animalName } from '../../utils/animalName';
import { Minidenticon } from './Minidenticon';
import { Badge } from './Badge';

interface Props {
  pubkey: string;
  size?: number;
  class?: string;
  className?: string;
  showBadge?: boolean;
}

// Auto-select badge size based on avatar size
function getBadgeSize(avatarSize: number): 'sm' | 'md' | 'lg' {
  if (avatarSize <= 32) return 'sm';
  if (avatarSize <= 48) return 'md';
  return 'lg';
}

/**
 * User avatar with profile picture or fallback minidenticon
 * Optionally shows social graph badge (checkmark for followed users)
 */
export function Avatar({ pubkey, size = 40, class: classProp, className, showBadge = false }: Props) {
  const cssClass = classProp || className;
  const profile = useProfile(pubkey);
  const [imgError, setImgError] = useState(false);

  // Reset error state when pubkey changes
  useEffect(() => {
    setImgError(false);
  }, [pubkey]);

  const name = getProfileName(profile, pubkey) || animalName(pubkey);

  const avatarContent = profile?.picture && !imgError ? (
    <img
      src={profile.picture}
      alt={name}
      title={name}
      width={size}
      height={size}
      className={`rounded-full object-cover ${cssClass || ''}`}
      onError={() => setImgError(true)}
    />
  ) : (
    <div title={name}>
      <Minidenticon seed={pubkey} size={size} className={cssClass} />
    </div>
  );

  if (!showBadge) {
    return avatarContent;
  }

  const badgeSize = getBadgeSize(size);

  return (
    <div className="relative inline-block">
      {avatarContent}
      <Badge
        pubKeyHex={pubkey}
        size={badgeSize}
        className="absolute -top-0.5 -right-0.5"
      />
    </div>
  );
}
