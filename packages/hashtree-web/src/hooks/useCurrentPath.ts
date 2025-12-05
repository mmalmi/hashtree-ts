/**
 * Hook to derive current directory path from URL
 * Uses actual hashtree data to determine if last segment is file or directory
 */
import { usePathType } from './usePathType';

/**
 * Get current directory path from URL
 * Resolves against hashtree to correctly identify files vs directories
 */
export function useCurrentPath(): string[] {
  const { dirPath } = usePathType();
  return dirPath;
}
