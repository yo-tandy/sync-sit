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

describe('app bar switch entries', () => {
  it('shows the sync-sit switch entry in the tutor menu', () => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: /open sync-sit/i })).toBeInTheDocument();
  });

  it('shows the sync-sit switch entry in the family menu', () => {
    renderWithProviders(<FamilyAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: /open sync-sit/i })).toBeInTheDocument();
  });
});

/**
 * The burger switch row and the app-switch bar (#365) must never both be
 * reachable at the same viewport: the bar's whole-bar lock does not extend to
 * the burger, so a second row would let a user mint a second handoff code
 * around it. Below `md` the bar is the entry point and the row hides; at
 * `md+` the bar is `md:hidden` and the row is the only switcher there is,
 * until Q9 is answered (#417).
 *
 * jsdom loads no Tailwind, so asserting the class alone would prove nothing
 * about the tab order or the a11y tree. `phoneViewport` supplies the one rule
 * the pin turns on and models a sub-md screen by leaving `md:block` unapplied.
 */
function phoneViewport() {
  const style = document.createElement('style');
  style.textContent = '.hidden { display: none }';
  document.head.append(style);
}

describe('the burger switch row hides where the app-switch bar takes over', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('tutor bar: the row is out of the a11y tree on phones', () => {
    phoneViewport();
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.queryByRole('button', { name: /open sync-sit/i })).toBeNull();
  });

  it('family bar: the row is out of the a11y tree on phones', () => {
    phoneViewport();
    renderWithProviders(<FamilyAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.queryByRole('button', { name: /open sync-sit/i })).toBeNull();
  });

  it('both bars keep the row at md+, where no app-switch bar renders', () => {
    for (const bar of [<AppBar key="t" />, <FamilyAppBar key="f" />]) {
      renderWithProviders(bar);
      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      const wrapper = screen.getByRole('button', { name: /open sync-sit/i }).parentElement!;
      expect(wrapper.className).toMatch(/\bhidden\b/);
      expect(wrapper.className).toMatch(/\bmd:block\b/);
      cleanup();
    }
  });

  it('the row uses the 48px bar-weight mark, never the 256px original (#364)', () => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const img = screen.getByRole('button', { name: /open sync-sit/i }).querySelector('img')!;
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
