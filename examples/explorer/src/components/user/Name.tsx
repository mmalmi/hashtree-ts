import { useProfile, getProfileName } from '../../hooks/useProfile';
import { animalName } from '../../utils/animalName';

interface Props {
  pubkey: string;
  class?: string;
  className?: string;
}

/**
 * Display name with profile fetch and animal name fallback
 */
export function Name({ pubkey, class: classProp, className }: Props) {
  const cssClass = classProp || className;
  const profile = useProfile(pubkey);
  const profileName = getProfileName(profile, pubkey);

  if (profileName) {
    return <span className={`truncate ${cssClass || ''}`}>{profileName}</span>;
  }

  // Animal name fallback (styled differently)
  const animal = animalName(pubkey);
  return (
    <span className={`truncate italic opacity-70 ${cssClass || ''}`}>
      {animal}
    </span>
  );
}
