/**
 * Hash-based navigation helper
 * Works both inside and outside React components
 */
export function navigate(path: string) {
  window.location.hash = path;
}
