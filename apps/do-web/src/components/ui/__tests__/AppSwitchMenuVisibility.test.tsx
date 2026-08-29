import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { DoerAppBar } from '../DoerAppBar';
import { FamilyAppBar } from '../FamilyAppBar';

/**
 * The burger switch rows and the app-switch bar (#365) must never both be
 * reachable at the same viewport: the bar's whole-bar lock does not extend to
 * the burger, so a second row would let a user mint a second handoff code
 * around it. Below `md` the bar is the entry point and the rows hide; at
 * `md+` the bar is `md:hidden` and the rows are the only switcher there is,
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

const BARS = [
  { name: 'doer', bar: <DoerAppBar /> },
  { name: 'family', bar: <FamilyAppBar /> },
];

describe('do-web burger switch rows hide where the app-switch bar takes over', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });

  for (const { name, bar } of BARS) {
    it(`${name} bar: BOTH rows are out of the a11y tree on phones`, () => {
      phoneViewport();
      renderWithProviders(bar);
      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      expect(screen.queryByRole('button', { name: /open sync-sit/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /open sync-study/i })).toBeNull();
    });

    it(`${name} bar: both rows return at md+, where no app-switch bar renders`, () => {
      renderWithProviders(bar);
      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      // Both rows share ONE wrapper — do-web is the two-target switcher.
      const wrapper = screen.getByRole('button', { name: /open sync-sit/i }).parentElement!;
      expect(wrapper.className).toMatch(/\bhidden\b/);
      expect(wrapper.className).toMatch(/\bmd:block\b/);
      expect(wrapper).toContainElement(screen.getByRole('button', { name: /open sync-study/i }));
    });
  }

  it('the rows use the 48px bar-weight marks, never the 256px originals (#364)', () => {
    // do-web imported TWO full marks for two 20px slots — the largest single
    // instance of the regression #364 exists to prevent.
    renderWithProviders(<DoerAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    for (const label of [/open sync-sit/i, /open sync-study/i]) {
      const img = screen.getByRole('button', { name: label }).querySelector('img')!;
      expect(img.getAttribute('src') ?? '').toMatch(/-48\./);
      expect(img.getAttribute('srcset') ?? '').toMatch(/-96\./);
    }
  });
});
