import { describe, it, expect, afterEach, vi } from 'vitest';
import { isRunningAsPWA } from '../pwa.js';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

describe('isRunningAsPWA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Clean up navigator.standalone if the test set it
    if (typeof navigator !== 'undefined') {
      delete (navigator as NavigatorWithStandalone).standalone;
    }
  });

  it('returns false when window is undefined (SSR / Node)', () => {
    vi.stubGlobal('window', undefined);
    expect(isRunningAsPWA()).toBe(false);
  });

  it('returns true when display-mode standalone matches', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' }),
    });
    expect(isRunningAsPWA()).toBe(true);
  });

  it('returns true on iOS Safari when navigator.standalone is true', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    (navigator as NavigatorWithStandalone).standalone = true;
    expect(isRunningAsPWA()).toBe(true);
  });

  it('returns false in a regular browser tab (no standalone flags)', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    (navigator as NavigatorWithStandalone).standalone = false;
    expect(isRunningAsPWA()).toBe(false);
  });

  it('returns false when matchMedia is unavailable and navigator.standalone is missing', () => {
    vi.stubGlobal('window', {});
    expect(isRunningAsPWA()).toBe(false);
  });
});
