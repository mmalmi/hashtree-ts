import { useState, useEffect } from 'react';
import { useProfile, getProfileName } from '../../hooks/useProfile';
import { animalName } from '../../utils/animalName';
import { Minidenticon } from './Minidenticon';

interface Props {
  pubkey: string;
  size?: number;
  class?: string;
  className?: string;
}

/**
 * User avatar with profile picture or fallback minidenticon
 */
export function Avatar({ pubkey, size = 40, class: classProp, className }: Props) {
  const cssClass = classProp || className;
  const profile = useProfile(pubkey);
  const [imgError, setImgError] = useState(false);

  // Reset error state when pubkey changes
  useEffect(() => {
    setImgError(false);
  }, [pubkey]);

  const name = getProfileName(profile, pubkey) || animalName(pubkey);

  if (profile?.picture && !imgError) {
    return (
      <img
        src={profile.picture}
        alt={name}
        title={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${cssClass || ''}`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div title={name}>
      <Minidenticon seed={pubkey} size={size} className={cssClass} />
    </div>
  );
}
