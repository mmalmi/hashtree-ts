import { useMemo } from 'react';
import { minidenticon } from 'minidenticons';

interface Props {
  seed: string;
  size?: number;
  saturation?: number;
  lightness?: number;
  class?: string;
  className?: string;
}

/**
 * Generates a deterministic identicon SVG from a seed string
 */
export function Minidenticon({ seed, size = 40, saturation = 50, lightness = 50, class: classProp, className }: Props) {
  const cssClass = classProp || className;
  const svgURI = useMemo(
    () => 'data:image/svg+xml;utf8,' + encodeURIComponent(minidenticon(seed, saturation, lightness)),
    [seed, saturation, lightness]
  );

  return (
    <img
      src={svgURI}
      alt=""
      width={size}
      height={size}
      className={`rounded-full ${cssClass || ''}`}
    />
  );
}
