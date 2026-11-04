import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { SideNav } from '@ejm/shared-ui';

const sections = [
  { items: [{ to: '/admin', label: 'Dashboard', end: true }] },
  {
    title: 'People',
    items: [
      { to: '/admin/users', label: 'Users' },
      { to: '/admin/families', label: 'Families' },
    ],
  },
];

/**
 * Issue #119 (UX F5): the sidebar rendering of persistent desktop nav, for
 * portals with too many destinations for a tab row (sit admin). jsdom applies
 * no CSS — `hidden md:block` on the <nav> is the viewport-conditional
 * contract, sticky top-12 glues it under the h-12 app bar.
 */
describe('SideNav (shared-ui)', () => {
  it('renders grouped sections with the uppercase-label heading idiom', () => {
    renderWithProviders(<SideNav sections={sections} ariaLabel="Primary navigation" />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const heading = within(nav).getByRole('heading', { name: 'People' });
    expect(heading.className).toMatch(/\buppercase\b/);
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
  });

  it('is hidden below md and sticky under the h-12 bar (class pins)', () => {
    renderWithProviders(<SideNav sections={sections} ariaLabel="Primary navigation" />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    // The sticky/scroll/visibility classes live on the WRAPPING div, not the
    // <nav> itself (#492 review) — see the "head renders as a sibling" pin
    // below for why the <nav> no longer carries them directly.
    const wrapper = nav.parentElement!;
    expect(wrapper.className).toMatch(/\bhidden\b/);
    expect(wrapper.className).toMatch(/\bmd:block\b/);
    expect(wrapper.className).toMatch(/\bsticky\b/);
    expect(wrapper.className).toMatch(/\btop-12\b/);
  });

  /**
   * #492 review: `head` used to render INSIDE this component's own `<nav
   * aria-label={ariaLabel}>`, so a `head` that renders its own `<nav>`
   * landmark (exactly what `AppSwitchInline`/`AppSwitchBar` do) ended up
   * nested nav-inside-nav at md+ — the pattern this PR avoids everywhere
   * else a hidden `<nav>` gets embedded into a host. `head` now renders as
   * a SIBLING of the sections' `<nav>`, both children of the shared
   * sticky/scroll wrapper.
   */
  it('renders `head` as a SIBLING of the sections’ nav, never nested inside it', () => {
    renderWithProviders(
      <SideNav
        sections={sections}
        ariaLabel="Primary navigation"
        head={<nav aria-label="Switch app">head content</nav>}
      />,
    );
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const switcher = screen.getByRole('navigation', { name: 'Switch app' });
    expect(primary.contains(switcher)).toBe(false);
    // Both live under the same sticky/scroll wrapper, not unrelated trees --
    // `head`'s own `mb-4 border-b` spacer div sits between the wrapper and
    // the switcher, so this checks the shared ancestor rather than direct
    // parentElement equality.
    expect(primary.parentElement!.contains(switcher)).toBe(true);
  });

  it('marks the current route active with brand styling, honoring end-matching', () => {
    renderWithProviders(<SideNav sections={sections} ariaLabel="Primary navigation" />, '/admin/users');
    const active = screen.getByRole('link', { name: 'Users' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.className).toMatch(/bg-brand-50/);
    // The end-matched Dashboard entry must NOT light up on a child route.
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
  });
});
