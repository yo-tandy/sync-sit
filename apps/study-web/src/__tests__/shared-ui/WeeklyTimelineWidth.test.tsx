import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { Card, WeeklyTimeline } from '@ejm/shared-ui';

/**
 * Pins the grid's width floor (issue #227). jsdom has no layout engine, so
 * the pinnable surface is the class contract. The bound is set by the
 * NARROWEST render site on the NARROWEST mainstream device: the
 * holiday-period grid nested in a Card, on a 360px-wide phone --
 * 360 - 40 (page px-5) - 32 (Card p-4) - 2 (borders) = 286. A floor above
 * that re-clips the Sunday column with no touch escape (the wrapper is
 * touch-none) -- in both apps, since this is one shared component.
 */
describe('WeeklyTimeline width floor', () => {
  it('keeps the min-width within the Card-nested render site on a 360px phone (<=286px)', () => {
    const empty = () => new Array(96).fill(false);
    const weekly = { mon: empty(), tue: empty(), wed: empty(), thu: empty(), fri: empty(), sat: empty(), sun: empty() };
    renderWithProviders(
      <WeeklyTimeline weekly={weekly} onChange={() => {}} onDayHeaderClick={() => {}} />,
    );
    const floor = screen.getByTestId('timeline-width-floor');
    const m = floor.className.match(/min-w-\[(\d+)px\]/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(286);
  });

  it('pins the derivation inputs of the 316 bound, so a padding change re-opens the math', () => {
    // 286 = 360 - 40 (page px-5) - 32 (Card p-4) - 2 (Card border). jsdom
    // cannot measure layout, so the next best thing is pinning the inputs:
    // if the Card's padding or border classes change, this fails and forces
    // the bound above to be re-derived instead of silently going stale --
    // exactly how the first round of this fix went wrong (PR #231 review).
    const { container } = renderWithProviders(<Card>x</Card>);
    const card = container.firstElementChild!;
    expect(card.className).toContain('p-4');
    expect(card.className).toContain('border');
    expect(card.className).not.toMatch(/p-[5-9]/);
    // A thicker border shifts the bound too ('border-gray-200' would still
    // satisfy the plain 'border' check, so guard the width variants).
    expect(card.className).not.toMatch(/border-[2-9]/);
  });
});
