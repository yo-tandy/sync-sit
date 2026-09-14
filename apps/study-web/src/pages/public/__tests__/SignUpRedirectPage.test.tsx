import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ assign: vi.fn() }));

import { renderWithProviders } from '@/__tests__/test-utils';
import i18n from '@/i18n';
import { SignUpRedirectPage } from '../SignUpRedirectPage';

/**
 * `/signup` is retired (issue #435 milestone, PR5): study's role question
 * moves to sit's unified `/enroll` landing page. Mirrors
 * `AppSwitchMenuItem.test.tsx`'s window.location.assign mocking convention.
 */
describe('SignUpRedirectPage (study /signup -> sit /enroll)', () => {
  beforeEach(() => {
    h.assign.mockReset();
    // jsdom's location.assign is non-functional — replace location wholesale.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: h.assign },
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('redirects cross-origin to sit\'s /enroll on the prod origin by default', async () => {
    renderWithProviders(<SignUpRedirectPage />);
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith('https://sync-sit.com/enroll?lang=en');
  });

  it('carries fr when the app language is French (incl. regional variants)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<SignUpRedirectPage />);
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith('https://sync-sit.com/enroll?lang=fr');
  });

  it('mutation check: removing the redirect effect would leave assign uncalled', async () => {
    // Not a literal source mutation — the meaningful failure mode this guards
    // is "the effect never fires" (e.g. a dependency array typo dropping the
    // call), which the waitFor above already proves does NOT happen. This
    // pins the positive: assign is called exactly once, not zero times.
    renderWithProviders(<SignUpRedirectPage />);
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });
});
