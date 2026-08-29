import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

/**
 * The burger switch row and the app-switch bar (#365) must never both be
 * reachable at the same viewport: the bar's whole-bar lock does not extend to
 * the burger, so a second row would let a user mint a second handoff code
 * around it and orphan the first. They must never both be ABSENT either --
 * that is app switching disappearing.
 *
 * Three cases, and they are not symmetric:
 *   below md, parent/babysitter -> bar only, row hidden
 *   at md+,   every role        -> row only, bar is md:hidden (Q9, #417)
 *   any width, ADMIN            -> row only, AdminLayout renders no bar
 */
const SWITCH_ROW = /open sync-study/i;

/**
 * jsdom loads no Tailwind, so asserting the class name alone would prove
 * nothing about the tab order or the a11y tree. This supplies the one rule
 * the pin turns on -- `.hidden { display: none }` -- and models a PHONE
 * viewport by leaving `md:block` unapplied, exactly as a sub-md screen does.
 * `getByRole` then excludes the row the way a screen reader would.
 */
function phoneViewport() {
  const style = document.createElement('style');
  style.textContent = '.hidden { display: none }';
  document.head.append(style);
  return style;
}

function openMenu(role: UserRole) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role={role} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
}

describe('the burger switch row vs the app-switch bar (#365)', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('is out of the a11y tree on phones for parents — the bar is the entry point there', () => {
    phoneViewport();
    openMenu('parent');
    expect(screen.queryByRole('button', { name: SWITCH_ROW })).toBeNull();
  });

  it('is out of the a11y tree on phones for babysitters', () => {
    phoneViewport();
    openMenu('babysitter');
    expect(screen.queryByRole('button', { name: SWITCH_ROW })).toBeNull();
  });

  it('SURVIVES on phones for admins — AdminLayout renders no app-switch bar', () => {
    // The regression this prevents: hiding the row for every role would leave
    // a phone admin with no way to reach sync-study at all, because
    // apps/web/src/layouts/AdminLayout.tsx has no <AppSwitchBarHost />.
    phoneViewport();
    openMenu('admin');
    expect(screen.getByRole('button', { name: SWITCH_ROW })).toBeInTheDocument();
  });

  it('returns at md+ for parents, where the bar is md:hidden (Q9, #417)', () => {
    // No phone stylesheet: without `.hidden` painting, the row is present.
    // The class pair is the responsive contract -- jsdom evaluates no media
    // queries, so this half has to be asserted on the classes.
    openMenu('parent');
    const wrapper = screen.getByRole('button', { name: SWITCH_ROW }).parentElement!;
    expect(wrapper.className).toMatch(/\bhidden\b/);
    expect(wrapper.className).toMatch(/\bmd:block\b/);
  });

  it('carries NO hiding class at all for admins', () => {
    openMenu('admin');
    const wrapper = screen.getByRole('button', { name: SWITCH_ROW }).parentElement!;
    expect(wrapper.className).not.toMatch(/\bhidden\b/);
  });
});

describe('the burger switch row uses bar-weight marks (#364)', () => {
  afterEach(cleanup);

  it('renders the 48px variant with a 96px 2x, never the 256px original', () => {
    // A 20px slot fed by a ~100 KB asset is the exact regression #364 exists
    // to prevent, and it is invisible: the row renders identically either way.
    openMenu('admin');
    const img = screen.getByRole('button', { name: SWITCH_ROW }).querySelector('img')!;
    expect(img.getAttribute('src') ?? '').toMatch(/-48\./);
    expect(img.getAttribute('srcset') ?? '').toMatch(/-96\./);
  });
});
