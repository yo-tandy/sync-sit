import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { AppBar } from '../AppBar';
import type { UserRole } from '@ejm/sit-core';

function renderBar(role: UserRole) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role={role} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/**
 * Issue #119 (UX F5): the burger's primary destinations render a second time
 * as a persistent md+ tab row — same link list, two renderings. These pins
 * hold each role's tab row to the full burger list (no curation drift), and
 * pin that admin gets NO tab row: its desktop nav is the grouped sidebar in
 * AdminLayout (PR 3 of the #119 stack).
 */
describe('sit desktop nav tabs', () => {
  afterEach(cleanup);

  it('parent AppBar promotes every primary burger destination to the md+ tabs', () => {
    renderBar('parent');
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    // Owner's menu order (issue #339): identity and family configuration
    // first, then activity. /family/invite is GONE from the nav entirely --
    // co-parent moved inside family settings (issue #340).
    expect(hrefs).toEqual([
      '/family/account',
      '/family/settings',
      '/family/governance',
      '/family/verification',
      '/family/appointments',
      '/family/endorsements',
      '/family/preferred',
    ]);
  });

  it('babysitter AppBar promotes every primary burger destination to the md+ tabs', () => {
    renderBar('babysitter');
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/babysitter/account',
      '/babysitter/options',
      '/babysitter/endorsements',
      '/babysitter/families',
    ]);
  });

  it('admin AppBar renders no tab row (the sidebar owns admin desktop nav)', () => {
    renderBar('admin');
    expect(screen.queryByRole('navigation', { name: /primary navigation/i })).not.toBeInTheDocument();
  });

  it('the tab row is hidden below md (class pin — jsdom applies no CSS)', () => {
    renderBar('parent');
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:block\b/);
  });
});
