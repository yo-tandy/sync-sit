import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Activation requires contact-visibility consent: a student who left the
 * enrollment consent box unticked (or a classic enrollee who was never asked)
 * must accept contact sharing in the activation dialog, and the activation
 * write records it on the root doc (firestore.rules
 * contactVisibilityConsentValid rejects an activation without it). Harness
 * mirrors DashboardPage.loading.test.tsx.
 */
const h = vi.hoisted(() => ({
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
  auth: {
    userDoc: null as unknown,
    firebaseUser: { uid: 'bs-1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
  onSnapshot: (_ref: unknown, cb: (snap: unknown) => void) => {
    cb({ docs: [], data: () => ({}) });
    return () => {};
  },
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('@/hooks/useAppointments', () => ({
  useAppointments: () => ({ pending: [], confirmed: [], pastRecent: [], rejectedRecent: [], loading: false }),
}));
vi.mock('@/hooks/useSchedule', () => ({
  useSchedule: () => ({ weekly: {}, overrides: [], loading: false }),
}));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));
vi.mock('@/components/published/PublishedSearchesPreview', () => ({
  PublishedSearchesPreview: () => null,
}));

import '@/i18n';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BabysitterDashboard } from '../DashboardPage';

const CONSENT_LABEL = /access to my contact information/i;

function babysitterDoc(root: Record<string, unknown> = {}, searchable = false) {
  return {
    uid: 'bs-1',
    firstName: 'Lea',
    ...root,
    profiles: {
      babysitter: {
        ejemEmail: 'lea@ejm.org',
        searchable,
        // isBabysitterProfileComplete: activation's own pre-existing gate.
        languages: ['fr'],
        kidAgeRange: { min: 2, max: 10 },
        maxKids: 2,
        hourlyRate: 15,
        areaMode: 'arrondissements',
        arrondissements: ['16'],
      },
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BabysitterDashboard />
    </MemoryRouter>,
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
}

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  });
  h.updateDoc.mockClear();
  h.auth.refreshUserDoc.mockClear();
});

afterEach(cleanup);

describe('babysitter dashboard activation — contact-visibility consent', () => {
  it('no consent on the doc: Activate is disabled until the box is ticked', async () => {
    h.auth.userDoc = babysitterDoc({ contactVisibilityConsent: false });
    renderPage();
    openDialog();
    const activate = await screen.findByRole('button', { name: 'Activate' });
    expect(activate).toBeDisabled();
    fireEvent.click(activate);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('ticking the box activates AND records the consent on the root doc', async () => {
    h.auth.userDoc = babysitterDoc({ contactVisibilityConsent: false });
    renderPage();
    openDialog();
    fireEvent.click(await screen.findByRole('checkbox', { name: CONSENT_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/bs-1' }),
        expect.objectContaining({ 'profiles.babysitter.searchable': true, contactVisibilityConsent: true }),
      ),
    );
  });

  it('classic enrollee (field absent) is asked too', async () => {
    h.auth.userDoc = babysitterDoc();
    renderPage();
    openDialog();
    expect(await screen.findByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
  });

  it('consent given at enrollment: no box, and the write does not touch it', async () => {
    h.auth.userDoc = babysitterDoc({ contactVisibilityConsent: true });
    renderPage();
    openDialog();
    const activate = await screen.findByRole('button', { name: 'Activate' });
    expect(screen.queryByRole('checkbox', { name: CONSENT_LABEL })).not.toBeInTheDocument();
    fireEvent.click(activate);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const data = h.updateDoc.mock.calls[0][1];
    expect(data['profiles.babysitter.searchable']).toBe(true);
    expect(data).not.toHaveProperty('contactVisibilityConsent');
  });

  it('deactivation is never gated on consent', async () => {
    h.auth.userDoc = babysitterDoc({}, true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.queryByRole('checkbox', { name: CONSENT_LABEL })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const data = h.updateDoc.mock.calls[0][1];
    expect(data['profiles.babysitter.searchable']).toBe(false);
    expect(data).not.toHaveProperty('contactVisibilityConsent');
  });

  it('the box resets when the dialog is closed and reopened', async () => {
    h.auth.userDoc = babysitterDoc({ contactVisibilityConsent: false });
    renderPage();
    openDialog();
    fireEvent.click(await screen.findByRole('checkbox', { name: CONSENT_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    openDialog();
    expect(await screen.findByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked();
  });
});
