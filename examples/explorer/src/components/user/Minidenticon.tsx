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
 * with a neutral circular background
 */
export function Minidenticon({ seed, size = 40, saturation = 50, lightness = 50, class: classProp, className }: Props) {
  const cssClass = classProp || className;
  const svgURI = useMemo(
    () => 'data:image/svg+xml;utf8,' + encodeURIComponent(minidenticon(seed, saturation, lightness)),
    [seed, saturation, lightness]
  );

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 bg-surface-3 ${cssClass || ''}`}
      style={{ width: size, height: size }}
    >
      <img
        src={svgURI}
        alt=""
        width={size * 0.7}
        height={size * 0.7}
      />
    </div>
  );
}
