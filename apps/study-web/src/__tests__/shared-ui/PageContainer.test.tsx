import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageContainer } from '@ejm/shared-ui';

/**
 * Issue #119 (UX F5): the portal shells cap routed content at a reading width
 * on desktop; grid/table pages opt into the wider tier by putting
 * data-page-width="wide" on their root, picked up via the container's CSS
 * :has() variant. jsdom applies no CSS, so these are class pins — the classes
 * ARE the responsive contract.
 */
describe('PageContainer (shared-ui)', () => {
  it('centers content at the default reading cap with the wide-tier :has() opt-in', () => {
    render(
      <PageContainer>
        <p>content</p>
      </PageContainer>,
    );
    const container = screen.getByText('content').parentElement!;
    expect(container.className).toMatch(/\bmx-auto\b/);
    expect(container.className).toMatch(/\bw-full\b/);
    expect(container.className).toMatch(/\bmax-w-2xl\b/);
    expect(container.className).toContain('has-[[data-page-width=wide]]:max-w-5xl');
  });

  it('wide pages carry the opt-in attribute the container selects on', () => {
    render(
      <PageContainer>
        <div data-page-width="wide">wide page</div>
      </PageContainer>,
    );
    const page = screen.getByText('wide page');
    expect(page.getAttribute('data-page-width')).toBe('wide');
  });
});
