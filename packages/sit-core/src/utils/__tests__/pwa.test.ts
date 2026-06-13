import { describe, it, expect, afterEach, vi } from 'vitest';
import { isRunningAsPWA } from '../pwa.js';

describe('isRunningAsPWA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    vi.stubGlobal('navigator', { standalone: true });
    expect(isRunningAsPWA()).toBe(true);
  });

  it('returns false in a regular browser tab (no standalone flags)', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('navigator', { standalone: false });
    expect(isRunningAsPWA()).toBe(false);
  });

  it('returns false when matchMedia is unavailable and navigator.standalone is missing', () => {
    vi.stubGlobal('window', {});
    expect(isRunningAsPWA()).toBe(false);
  });
});
