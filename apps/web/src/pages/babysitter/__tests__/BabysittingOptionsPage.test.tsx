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
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
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

  it('a clicked area chip stays selected across the re-render it causes', async () => {
    // Regression: `getBabysitterView` returns a fresh object every render
    // (packages/sit-core/src/types/sitUserAdapter.ts), so the seeding effect
    // used to run unguarded on `[babysitter]` — including on the very
    // re-render `toggleArea`'s own `setArrondissements` triggers — which
    // reset `arrondissements` straight back to the userDoc snapshot and made
    // every chip click revert itself. Clicking twice (select, then a second
    // click elsewhere that forces another render) is what would have
    // exposed it; a single click already fails without the seededRef guard.
    renderPage();
    const chip16e = screen.getByRole('button', { name: /16e/i });
    expect(chip16e.textContent).not.toContain('✓');

    fireEvent.click(chip16e);
    expect(chip16e.textContent).toContain('✓');

    // Force a second render pass (any state update in the component works;
    // the rate input is unrelated to arrondissements) and confirm the
    // selection survived it.
    fireEvent.change(screen.getByLabelText(/rate/i), { target: { value: '20' } });
    expect(chip16e.textContent).toContain('✓');

    // The originally-seeded '1er' must still be there too — this proves the
    // effect didn't silently re-seed and wipe it.
    expect(screen.getByRole('button', { name: /1er/i }).textContent).toContain('✓');
  });

  it('save no longer writes profiles.babysitter.aboutMe', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload)).not.toContain('profiles.babysitter.aboutMe');
    // The preference fields are still saved from here.
    expect(payload['profiles.babysitter.hourlyRate']).toBe(15);
    expect(payload['profiles.babysitter.maxKids']).toBe(3);
    expect(payload['profiles.babysitter.kidAgeRange']).toEqual({ min: 3, max: 12 });
  });
});
