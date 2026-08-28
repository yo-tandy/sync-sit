import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageContainer } from '@ejm/shared-ui';

/**
 * Issue #119 (UX F5): the portal shells cap routed content at a reading width
 * on desktop; grid/table pages opt into the wider tier by putting
 * data-page-width="wide" on their root, picked up via the container's
 * direct-child CSS :has() variant. jsdom applies no CSS, so these are class
 * pins — the classes ARE the responsive contract. The pages that opt in are
 * pinned in their own test files (family DashboardPage, tutor SchedulePage).
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
    expect(container.className).toContain('has-[>[data-page-width=wide]]:max-w-5xl');
  });

  it('renders children as DIRECT children of the capped div (the > selector precondition)', () => {
    // The wide opt-in is scoped to :has(>[data-page-width=wide]) so only a
    // page ROOT can widen the route. That only works if PageContainer puts no
    // wrapper element between the capped div and the routed page.
    render(
      <PageContainer>
        <div data-page-width="wide">wide page</div>
      </PageContainer>,
    );
    const page = screen.getByText('wide page');
    expect(page.parentElement!.className).toContain('has-[>[data-page-width=wide]]:max-w-5xl');
  });

  it('a nested (non-root) wide marker is not a direct child of the capped div — the > scope makes it a no-op', () => {
    // The failure mode the direct-child scoping creates: wrap a page root in
    // an extra element (ErrorBoundary div, layout fragment) and the wide
    // opt-in silently stops matching. This pin documents that contract; the
    // real widening is CSS, which jsdom cannot execute.
    render(
      <PageContainer>
        <div>
          <div data-page-width="wide">nested wide</div>
        </div>
      </PageContainer>,
    );
    const marker = screen.getByText('nested wide');
    expect(marker.parentElement!.className).not.toContain('has-[>[data-page-width=wide]]:max-w-5xl');
  });
});
