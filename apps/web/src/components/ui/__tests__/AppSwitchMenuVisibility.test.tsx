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
 * The burger switch row must never be reachable at the same viewport as
 * whichever entry point already covers that width -- a second one would let
 * a user mint a second handoff code around the first's whole-bar lock (the
 * bar's) or just duplicate the landmark (the inline switcher's, #417). They
 * must never both be ABSENT either -- that is app switching disappearing.
 *
 * Q9 (#417) resolved what used to sit at md+ here: it is no longer this
 * burger row for ANY role -- `AppSwitchInline` (in `AppBar` for parent /
 * babysitter, in `SideNav`'s head for admin) covers md+ instead. So the row
 * now has at most ONE reachable width, not two:
 *   below md, parent/babysitter -> bar only, row absent at every width
 *   below md, ADMIN             -> row only (AdminLayout renders no bar)
 *   at md+,   every role        -> row absent; AppSwitchInline covers it
 *     (see AppBarDesktopTabs.test.tsx / DesktopShell.test.tsx for that half)
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

  it('never renders for parents at ANY width -- #417 gave md+ to AppSwitchInline instead', () => {
    // No phone stylesheet: without `.hidden` painting, a still-present row
    // would show up here. Absence, not a hiding class, is the pin now.
    openMenu('parent');
    expect(screen.queryByRole('button', { name: SWITCH_ROW })).toBeNull();
  });

  it('never renders for babysitters at ANY width, for the same reason', () => {
    openMenu('babysitter');
    expect(screen.queryByRole('button', { name: SWITCH_ROW })).toBeNull();
  });

  it('is md:hidden for admins now (#417) -- the sidebar head’s AppSwitchInline covers md+', () => {
    // Flipped from before Q9: admin's row used to carry NO hiding class
    // (its only entry point, every width). Now AdminLayout's SideNav head
    // covers md+, so the burger row -- admin's sub-md-only entry point --
    // must hide there instead, or admin would have two reachable switchers
    // at md+.
    openMenu('admin');
    const wrapper = screen.getByRole('button', { name: SWITCH_ROW }).parentElement!;
    expect(wrapper.className).toMatch(/\bmd:hidden\b/);
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
