import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@ejm/shared-ui';

/**
 * Pins the fullWidth PROP contract (issue #226). Width must be a prop, not a
 * className override: conflicting Tailwind utilities resolve by generated-
 * stylesheet order, where w-full beats a caller's w-auto -- four call sites
 * wrote `className="w-auto"` believing it worked and got a full-width button
 * painted over its own row.
 */
describe('Button width', () => {
  it('is full-width by default', () => {
    render(<Button>go</Button>);
    const b = screen.getByRole('button', { name: 'go' });
    expect(b.className).toContain('w-full');
    expect(b.className).not.toContain('w-auto');
  });

  it('fullWidth={false} swaps w-full for w-auto rather than stacking both', () => {
    // Stacking would re-create the stylesheet-order coin toss this prop exists
    // to remove -- the base class must actually change.
    render(<Button fullWidth={false}>go</Button>);
    const b = screen.getByRole('button', { name: 'go' });
    expect(b.className).toContain('w-auto');
    expect(b.className).not.toContain('w-full');
  });

  it("size='icon' is sized by its own token, with neither w-full nor w-auto emitted", () => {
    // The icon token carries w-10; a competing width utility beside it would
    // re-create the stylesheet-order coin toss the prop removes.
    render(<Button size="icon" aria-label="bell" />);
    const b = screen.getByRole('button', { name: 'bell' });
    expect(b.className).toContain('w-10');
    expect(b.className).not.toContain('w-full');
    expect(b.className).not.toContain('w-auto');
  });
});
