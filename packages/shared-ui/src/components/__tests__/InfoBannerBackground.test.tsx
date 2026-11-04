import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InfoBanner } from '../InfoBanner.js';

/**
 * InfoBanner shares Card's `bg-* base + trailing className` shape, so it
 * shares the #429 risk: a caller's background override could silently lose
 * to the variant's own `bg-brand-50`/`bg-gray-50`. Fixed the same way, with
 * the same pin shape as CardBackground.test.tsx.
 */
afterEach(cleanup);

describe('InfoBanner background', () => {
  it('keeps the variant background when the caller passes no override', () => {
    render(<InfoBanner>note</InfoBanner>);
    // InfoBanner doesn't forward arbitrary props, so query by role/text instead.
    const banner = screen.getByText('note').parentElement as HTMLElement;
    expect(banner.className).toContain('bg-gray-50');
  });

  it("a caller's bg-blue-50 override wins over the variant background", () => {
    render(
      <InfoBanner variant="warning" className="bg-blue-50">
        note
      </InfoBanner>
    );
    const banner = screen.getByText('note').parentElement as HTMLElement;
    expect(banner.className).toContain('bg-blue-50');
    expect(banner.className).not.toContain('bg-brand-50');
  });
});
