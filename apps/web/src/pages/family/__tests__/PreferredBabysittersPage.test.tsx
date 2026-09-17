import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Issue #529 PR2 (#534 review): the preferred list resolves its cards through
// the getBabysitterSummaries callable — one batch, never users/{uid} reads —
// and a failed batch keeps what was already on screen.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  // Per-call behaviour: a resolved summaries array, or an Error to reject with.
  answer: [] as unknown[] | Error,
  // The families/{id} onSnapshot listener, captured so tests can emit.
  familyListener: null as null | ((snap: { data: () => Record<string, unknown> }) => void),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return h.answer instanceof Error
      ? Promise.reject(h.answer)
      : Promise.resolve({ data: { summaries: h.answer } });
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (_ref: unknown, cb: (snap: { data: () => Record<string, unknown> }) => void) => {
    h.familyListener = cb;
    return () => {};
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    userDoc: { uid: 'p1', profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } } },
  }),
}));
vi.mock('@/hooks/useFamilyAppointments', () => ({
  useFamilyAppointments: () => ({ pending: [], confirmed: [], rejectedRecent: [] }),
}));
vi.mock('@/lib/debouncedPreferred', () => ({ debouncedTogglePreferred: vi.fn() }));

import i18n from '@/i18n';
import { PreferredBabysittersPage } from '../PreferredBabysittersPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/family/preferred']}>
      <PreferredBabysittersPage />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.calls.length = 0;
  h.answer = [];
  h.familyListener = null;
});
afterEach(() => cleanup());

const LEA = { uid: 'bs1', firstName: 'Lea', lastName: 'Bernard', photoUrl: null, classLevel: 'Terminale', languages: ['fr'], worksInYourArea: true };
const HUGO = { uid: 'bs2', firstName: 'Hugo', lastName: 'Leroy', photoUrl: null, classLevel: 'Première', languages: ['fr'], worksInYourArea: false };

describe('family PreferredBabysittersPage — cards via getBabysitterSummaries', () => {
  it('asks for the whole preferred list in ONE callable batch and renders the returned cards', async () => {
    h.answer = [LEA, HUGO];
    renderPage();
    await act(async () => {
      h.familyListener!({ data: () => ({ preferredBabysitters: ['bs1', 'bs2'] }) });
    });
    await vi.waitFor(() => {
      const c = h.calls.filter((x) => x.name === 'getBabysitterSummaries');
      expect(c).toHaveLength(1);
      expect(c[0].payload).toEqual({ uids: ['bs1', 'bs2'] });
    });
    expect(await screen.findByText(/Lea/)).toBeInTheDocument();
    expect(screen.getByText(/Hugo/)).toBeInTheDocument();
  });

  it('a failed batch keeps the cards already on screen instead of wiping the list', async () => {
    h.answer = [LEA];
    renderPage();
    await act(async () => {
      h.familyListener!({ data: () => ({ preferredBabysitters: ['bs1'] }) });
    });
    expect(await screen.findByText(/Lea/)).toBeInTheDocument();

    // The list changes (a second preferred babysitter) but the batch fails.
    h.answer = new Error('offline');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      h.familyListener!({ data: () => ({ preferredBabysitters: ['bs1', 'bs2'] }) });
    });
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
    // Lea is still there; no "no preferred babysitters" empty state.
    expect(screen.getByText(/Lea/)).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('preferred.noPreferred'))).toBeNull();
    errSpy.mockRestore();
  });
});
