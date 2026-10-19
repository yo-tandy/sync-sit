import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Callable-error copy on the family search page: a rejected searchBabysitters
 * / sendContactRequest must show the translated generic message, never the raw
 * FunctionsError text (a bare `internal`, or English-only server strings).
 */

const FUTURE_DATE = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  getDoc: () =>
    Promise.resolve({
      exists: () => true,
      data: () => ({
        familyId: 'fam1',
        familyName: 'Dupont',
        address: '15 Rue de Passy, 75016 Paris',
        latLng: { lat: 48.85, lng: 2.27 },
        verification: { isFullyVerified: true },
        preferredBabysitters: [],
      }),
    }),
  getDocs: (target: { path?: string; query?: unknown[] }) => {
    const parts = target.query ?? [target];
    const path = (parts[0] as { path?: string }).path;
    if (path?.endsWith('/kids')) {
      return Promise.resolve({
        docs: [{ id: 'kid1', data: () => ({ firstName: 'Lucas', age: 6, languages: ['fr'] }) }],
      });
    }
    return Promise.resolve({ docs: [] });
  },
  onSnapshot: () => () => {},
  deleteDoc: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));

import i18n from '@/i18n';
import { SearchPage } from '../SearchPage';

const internalFault = () =>
  Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' }));

async function runSearch() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('One-time'));
  await waitFor(() => expect(screen.getByLabelText('Date *')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value: FUTURE_DATE } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  i18n.changeLanguage('en');
  h.callable.mockReset();
  h.auth.userDoc = {
    uid: 'p1',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
});

afterEach(cleanup);

describe('SearchPage callable errors never echo the raw message', () => {
  it('searchBabysitters internal fault shows the translated generic copy, not "internal"', async () => {
    h.callable.mockImplementation(() => internalFault());
    await runSearch();
    expect(await screen.findByText(i18n.t('common.error'))).toBeInTheDocument();
    expect(screen.queryByText('internal')).not.toBeInTheDocument();
  });

  it('sendContactRequest internal fault shows the translated generic copy, not "internal"', async () => {
    h.callable.mockImplementation((name: string) =>
      name === 'searchBabysitters'
        ? Promise.resolve({
            data: { results: [{ uid: 'bs-1', firstName: 'Marie', lastName: 'Dupont', age: 22, rate: 15 }] },
          })
        : name === 'sendContactRequest'
          ? internalFault()
          : Promise.resolve({ data: {} }),
    );
    await runSearch();
    fireEvent.click(await screen.findByText('Marie DUPONT'));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('search.contact', { name: 'Marie' }) }));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('search.sendRequest') }));
    expect(await screen.findByText(i18n.t('common.error'))).toBeInTheDocument();
    expect(screen.queryByText('internal')).not.toBeInTheDocument();
  });
});
