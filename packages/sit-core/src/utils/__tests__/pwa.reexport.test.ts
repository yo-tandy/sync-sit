import { describe, it, expect, afterEach, vi } from 'vitest';
// Import through the local module (not @ejm/shared-core) — this pins the
// back-compat re-export that keeps `import { isRunningAsPWA } from
// '@ejm/sit-core'` consumers working after the promotion to shared-core.
import { isRunningAsPWA } from '../pwa.js';

describe('isRunningAsPWA re-export (back-compat)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is exported from sit-core utils and behaves (standalone => true)', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' }),
    });
    expect(isRunningAsPWA()).toBe(true);
  });

  it('returns false in a regular browser tab', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('navigator', { standalone: false });
    expect(isRunningAsPWA()).toBe(false);
  });
});
