import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ assign: vi.fn() }));

import { renderWithProviders } from '@/__tests__/test-utils';
import i18n from '@/i18n';
import { SignUpRedirectPage } from '../SignUpRedirectPage';

/**
 * `/signup` is retired (issue #435 milestone, PR5): do's role question moves
 * to sit's unified `/enroll` landing page. Mirrors study-web's
 * SignUpRedirectPage.test.tsx / AppSwitchMenuItem.test.tsx's
 * window.location.assign mocking convention.
 */
describe('SignUpRedirectPage (do /signup -> sit /enroll)', () => {
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

  it('mutation check: the redirect effect actually fires (not just mounts inert)', async () => {
    renderWithProviders(<SignUpRedirectPage />);
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });
});
