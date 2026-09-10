import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SkeletonCard } from '../SkeletonCard.js';

/**
 * SkeletonCard renders "the Card idiom" (same base string as Card, including
 * `bg-ground-raised`), so it shares the #429 risk. Fixed the same way, with
 * the same pin shape as CardBackground.test.tsx.
 */
afterEach(cleanup);

describe('SkeletonCard background', () => {
  it('keeps bg-ground-raised when the caller passes no override', () => {
    render(<SkeletonCard />);
    const card = screen.getByTestId('skeleton-card');
    expect(card.className).toContain('bg-ground-raised');
  });

  it("a caller's bg-amber-50 override wins, and bg-ground-raised is gone from the attribute", () => {
    render(<SkeletonCard className="bg-amber-50" />);
    const card = screen.getByTestId('skeleton-card');
    expect(card.className).toContain('bg-amber-50');
    expect(card.className).not.toContain('bg-ground-raised');
  });
});
