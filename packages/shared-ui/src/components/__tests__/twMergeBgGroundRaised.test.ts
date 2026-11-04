import { describe, it, expect } from 'vitest';
import { twMerge } from 'tailwind-merge';

/**
 * Proves the load-bearing assumption behind the #429 fix before trusting it
 * anywhere else: `bg-ground-raised` is a custom theme colour token (not a
 * class twMerge ships a rule for), and twMerge classifies an unrecognised
 * `bg-<x>` as a background-colour utility by default. If that classification
 * were ever wrong, Card/InfoBanner/SkeletonCard's fix would silently stop
 * resolving the conflict it exists to fix.
 */
describe('twMerge custom bg-* token handling', () => {
  it('treats bg-ground-raised as a background-colour conflict with bg-amber-50, keeping the later class', () => {
    expect(twMerge('bg-ground-raised', 'bg-amber-50')).toBe('bg-amber-50');
  });

  it('is order-sensitive: the later class always wins, not a fixed one', () => {
    expect(twMerge('bg-amber-50', 'bg-ground-raised')).toBe('bg-ground-raised');
  });

  it('leaves bg-ground-raised alone when nothing else names a background colour', () => {
    expect(twMerge('bg-ground-raised', 'border-amber-200')).toBe('bg-ground-raised border-amber-200');
  });
});
