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
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:block\b/);
    expect(nav.className).toMatch(/\bsticky\b/);
    expect(nav.className).toMatch(/\btop-12\b/);
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
