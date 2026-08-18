import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Issue #171 moved the about-me bio to the account page. These pins keep the
// options page scoped to babysitting preferences: no bio editor here, and the
// save payload never touches profiles.babysitter.aboutMe again.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'bs1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

// The autocomplete pulls in the Google Maps loader — irrelevant here.
vi.mock('@/components/forms/AddressAutocomplete', () => ({
  AddressAutocomplete: () => <div data-testid="address-autocomplete" />,
}));

import i18n from '@/i18n';
import { BabysittingOptionsPage } from '../BabysittingOptionsPage';

function userDoc() {
  return {
    uid: 'bs1',
    email: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    profiles: {
      babysitter: {
        enrollmentComplete: true,
        searchable: true,
        languages: ['English'],
        kidAgeRange: { min: 3, max: 12 },
        maxKids: 3,
        hourlyRate: 15,
        areaMode: 'arrondissement',
        arrondissements: ['1er'],
      },
    },
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <BabysittingOptionsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('BabysittingOptionsPage (post-#171 scope)', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.auth.userDoc = userDoc();
    h.updateDoc.mockClear();
    h.auth.refreshUserDoc.mockClear();
  });
  afterEach(() => cleanup());

  it('no longer renders the about-me editor (moved to My Account)', () => {
    renderPage();
    expect(screen.queryByRole('textbox', { name: /about me & experience/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/tell families about yourself/i)).toBeNull();
    // The page has no textarea at all anymore.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('save no longer writes profiles.babysitter.aboutMe', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('profiles.babysitter.aboutMe');
    // The preference fields are still saved from here.
    expect(payload['profiles.babysitter.hourlyRate']).toBe(15);
    expect(payload['profiles.babysitter.maxKids']).toBe(3);
    expect(payload['profiles.babysitter.kidAgeRange']).toEqual({ min: 3, max: 12 });
  });
});
