import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';

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

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';
import { FamilyAppBar } from '../FamilyAppBar';

describe('app bar switch entries (#417 -- inline switcher, not the burger row)', () => {
  it('shows the sync-sit entry in the tutor bar’s inline switcher (closed, no menu needed)', () => {
    renderWithProviders(<AppBar />);
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
  });

  it('shows the sync-sit entry in the family bar’s inline switcher', () => {
    renderWithProviders(<FamilyAppBar />);
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
  });

  it('the burger no longer carries a switch row at all, in either bar', () => {
    for (const bar of [<AppBar key="t" />, <FamilyAppBar key="f" />]) {
      renderWithProviders(bar);
      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      expect(screen.queryByRole('button', { name: /open sync-sit/i })).toBeNull();
      cleanup();
    }
  });
});

/**
 * The inline switcher and the app-switch bar (#365) must never both be
 * reachable at the same viewport: below `md` the bar (AppSwitchBarHost,
 * mounted by the layout, not tested here) is the entry point; at `md+` the
 * inline switcher rendered directly in these bars is. Q9 (#417) retired the
 * burger row entirely for study-web -- unlike sit, study-web has no admin
 * shell that needs it kept as a sub-md fallback (both its layouts always
 * mount AppSwitchBarHost).
 *
 * jsdom loads no Tailwind, so asserting the class alone would prove nothing
 * about the tab order or the a11y tree. `phoneViewport` supplies the one rule
 * the pin turns on and models a sub-md screen by leaving `md:block`/`md:flex`
 * unapplied.
 */
function phoneViewport() {
  const style = document.createElement('style');
  style.textContent = '.hidden { display: none }';
  document.head.append(style);
}

describe('the inline switcher is out of the a11y tree on phones, present at md+', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('tutor bar: hidden on phones', () => {
    phoneViewport();
    renderWithProviders(<AppBar />);
    expect(screen.queryByRole('button', { name: /sync\/sit/ })).toBeNull();
  });

  it('family bar: hidden on phones', () => {
    phoneViewport();
    renderWithProviders(<FamilyAppBar />);
    expect(screen.queryByRole('button', { name: /sync\/sit/ })).toBeNull();
  });

  it('both bars carry the hidden md:flex pair — visible only at md+', () => {
    for (const bar of [<AppBar key="t" />, <FamilyAppBar key="f" />]) {
      renderWithProviders(bar);
      const nav = screen.getByRole('navigation', { name: /switch app/i });
      expect(nav.className).toMatch(/\bhidden\b/);
      expect(nav.className).toMatch(/\bmd:flex\b/);
      cleanup();
    }
  });

  it('uses the 48px bar-weight mark, never the 256px original (#364)', () => {
    renderWithProviders(<AppBar />);
    const img = screen.getByRole('button', { name: /sync\/sit/ }).querySelector('img')!;
    expect(img.getAttribute('src') ?? '').toMatch(/-48\./);
    expect(img.getAttribute('srcset') ?? '').toMatch(/-96\./);
  });
});

const HIT_TARGET = /\bh-11\b[\s\S]*\bw-11\b|\bw-11\b[\s\S]*\bh-11\b/;

describe('app bar hit targets (≥44px, WCAG 2.5.8)', () => {
  it('tutor bar: home link and menu button are 44px targets with accessible names', () => {
    renderWithProviders(<AppBar />);
    expect(screen.getByRole('link', { name: /home/i }).className).toMatch(HIT_TARGET);
    expect(screen.getByRole('button', { name: /open menu/i }).className).toMatch(HIT_TARGET);
  });

  it('family bar: home link and menu button are 44px targets with accessible names', () => {
    renderWithProviders(<FamilyAppBar />);
    expect(screen.getByRole('link', { name: /home/i }).className).toMatch(HIT_TARGET);
    expect(screen.getByRole('button', { name: /open menu/i }).className).toMatch(HIT_TARGET);
  });
});
