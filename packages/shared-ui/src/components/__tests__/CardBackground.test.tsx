import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Card } from '../Card.js';

/**
 * Pins the twMerge className-merge contract (issue #429). Conflicting
 * Tailwind utilities resolve by generated-stylesheet order, not by position
 * in the class attribute -- the shape of issue #226 -- and in the built CSS
 * bg-amber-50 (and blue/brand/gray/green-50) are emitted BEFORE
 * bg-ground-raised, so a caller's `className="bg-amber-50"` lost silently to
 * Card's own base background. 34 of 37 `<Card className="bg-*">` call sites
 * were affected (warning/info banners across all three apps).
 */
afterEach(cleanup);

describe('Card background', () => {
  it("keeps bg-ground-raised when the caller passes no background override", () => {
    render(<Card data-testid="card">plain</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-ground-raised');
  });

  it("a caller's bg-amber-50 override wins, and bg-ground-raised is gone from the attribute", () => {
    render(
      <Card data-testid="card" className="bg-amber-50 border-amber-200">
        warning
      </Card>
    );
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-amber-50');
    expect(card.className).not.toContain('bg-ground-raised');
    // Non-conflicting classes from the caller still land.
    expect(card.className).toContain('border-amber-200');
  });
});
