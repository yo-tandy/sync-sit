import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WeeklyTimeline } from '@ejm/shared-ui';

/**
 * Pins the grid's width floor (issue #227). jsdom has no layout engine, so
 * the pinnable surface is the class contract: the floor must stay BELOW the
 * ~350px of content a 390px phone offers after page padding, or the grid
 * overflows by a sliver and clips the Sunday column with no visible scroll
 * affordance -- in both apps, since this is one shared component.
 */
describe('WeeklyTimeline width floor', () => {
  it('keeps the min-width under a 390px phone content width', () => {
    const empty = () => new Array(96).fill(false);
    const weekly = { mon: empty(), tue: empty(), wed: empty(), thu: empty(), fri: empty(), sat: empty(), sun: empty() };
    const { container } = render(
      <WeeklyTimeline weekly={weekly} onChange={() => {}} onDayHeaderClick={() => {}} />,
    );
    const floor = container.querySelector('[class*="min-w-["]');
    expect(floor).not.toBeNull();
    const m = floor!.className.match(/min-w-\[(\d+)px\]/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(350);
  });
});
