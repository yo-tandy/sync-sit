import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { NavTabs } from '@ejm/shared-ui';

const items = [
  { to: '/tutor/requests', label: 'Requests' },
  { to: '/tutor/endorsements', label: 'Endorsements', badge: 3 },
  { to: '/tutor/schedule', label: 'Schedule', badge: 0 },
];

/**
 * Issue #119 (UX F5): persistent primary nav at md+. jsdom applies no CSS, so
 * the desktop-only behavior is pinned via classes — `hidden md:block` on the
 * <nav> is the viewport-conditional contract, and sticky top-12 keeps the row
 * glued under the h-12 app bar.
 */
describe('NavTabs (shared-ui)', () => {
  it('renders one labelled nav with a link per destination', () => {
    renderWithProviders(<NavTabs items={items} ariaLabel="Primary navigation" />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(nav).getByRole('link', { name: /requests/i })).toHaveAttribute('href', '/tutor/requests');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
  });

  it('is hidden below md and sticky under the h-12 bar (class pins)', () => {
    renderWithProviders(<NavTabs items={items} ariaLabel="Primary navigation" />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:block\b/);
    expect(nav.className).toMatch(/\bsticky\b/);
    expect(nav.className).toMatch(/\btop-12\b/);
  });

  it('shows a badge only for positive counts', () => {
    renderWithProviders(<NavTabs items={items} ariaLabel="Primary navigation" />);
    const endorsements = screen.getByRole('link', { name: /endorsements/i });
    expect(within(endorsements).getByText('3').className).toMatch(/bg-amber-100/);
    const schedule = screen.getByRole('link', { name: /schedule/i });
    expect(within(schedule).queryByText('0')).not.toBeInTheDocument();
  });

  it('marks the current route active with brand styling (NavLink aria-current)', () => {
    renderWithProviders(<NavTabs items={items} ariaLabel="Primary navigation" />, '/tutor/requests');
    const active = screen.getByRole('link', { name: /requests/i });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.className).toMatch(/border-brand-600/);
    expect(active.className).toMatch(/text-brand-600/);
  });
});
