import { sha256 } from '@noble/hashes/sha2.js';
import animals from './data/animals.json';
import adjectives from './data/adjectives.json';

function capitalize(s: string): string {
  if (typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Deterministically create adjective + animal names from a seed (pubkey)
 */
export function animalName(seed: string): string {
  if (!seed) {
    throw new Error('No seed provided');
  }
  // Convert string to Uint8Array for @noble/hashes v2
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(seed));
  const adjective = adjectives[hash[0] % adjectives.length];
  const animal = animals[hash[1] % animals.length];
  return `${capitalize(adjective)} ${capitalize(animal)}`;
}
