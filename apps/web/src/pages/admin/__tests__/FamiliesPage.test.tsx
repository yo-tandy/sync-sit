import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock: the REAL adminStore runs against it, so these
// tests pin the exact callable name + payloads the families page sends.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  // Responses for successive listFamilies calls; the last one repeats.
  pages: [] as { families: Record<string, unknown>[]; hasMore: boolean }[],
  // When true, the next listFamilies call rejects (and resets the flag).
  failNext: false,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'listFamilies') {
      if (h.failNext) {
        h.failNext = false;
        return Promise.reject(new Error('internal'));
      }
      const page = h.pages.length > 1 ? h.pages.shift()! : h.pages[0];
      return Promise.resolve({ data: { families: [...page.families], hasMore: page.hasMore } });
    }
    return Promise.resolve({ data: { success: true } });
  },
}));

import i18n from '@/i18n';
import { AdminFamiliesPage } from '../FamiliesPage';
import { useAdminStore } from '@/stores/adminStore';

function family(overrides: Record<string, unknown> = {}) {
  return {
    familyId: 'fam-dupont',
    familyName: 'Dupont',
    address: '15 Rue de Passy, 75016 Paris',
    status: 'active',
    createdAt: '2026-01-01T10:00:00.000Z',
    verified: true,
    parents: [
      {
        uid: 'p1',
        firstName: 'Marie',
        lastName: 'Dupont',
        email: 'marie.dupont@test.com',
        status: 'active',
      },
      {
        uid: 'p2',
        firstName: 'Pierre',
        lastName: 'Dupont',
        email: 'pierre.dupont@test.com',
        status: 'blocked',
      },
    ],
    kids: [
      { firstName: 'Lucas', age: 6 },
      { firstName: 'Emma', age: 4 },
    ],
    kidsCount: 2,
    governedKidsCount: 1,
    preferredCount: 3,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminFamiliesPage />
    </MemoryRouter>,
  );
}

const calls = () => h.calls.filter((c) => c.name === 'listFamilies');

beforeEach(() => {
  i18n.changeLanguage('en');
  h.calls.length = 0;
  h.pages = [{ families: [family()], hasMore: false }];
  // The zustand store is a module-level singleton — reset between tests so a
  // previous test's rows can't satisfy this test's queries before its fetch.
  useAdminStore.setState({ families: [], familiesLoading: false, familiesHasMore: false });
});
afterEach(() => cleanup());

describe('AdminFamiliesPage', () => {
  it('fetches on mount with an empty payload (no filters) and renders the joined row', async () => {
    renderPage();

    expect(await screen.findByText('Dupont')).toBeInTheDocument();
    expect(calls()).toHaveLength(1);
    // No search/filters/cursor: every optional field is OMITTED (the callable
    // client serializes undefined as null, which zod .optional() rejects).
    expect(calls()[0].payload).toEqual({});

    expect(screen.getByText('15 Rue de Passy, 75016 Paris')).toBeInTheDocument();
    // The verified badge (the filter <option>s also say "Verified")
    const verifiedBadges = screen
      .getAllByText(/verified/i)
      .filter((el) => el.tagName !== 'OPTION');
    expect(verifiedBadges).toHaveLength(1);
    expect(verifiedBadges[0]).toHaveTextContent('Verified');
    // Parents with emails
    expect(screen.getByText(/Marie Dupont/)).toBeInTheDocument();
    expect(screen.getByText(/marie.dupont@test.com/)).toBeInTheDocument();
    // Kids summary
    expect(screen.getByText(/2 kids: Lucas \(6\), Emma \(4\)/)).toBeInTheDocument();
    // Governed kids count shown when > 0
    expect(screen.getByText(/1 governed kid/)).toBeInTheDocument();
    // createdAt
    expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();
  });

  it('hides the governed-kids count when zero and shows a status badge when deleted', async () => {
    h.pages = [
      {
        families: [
          family({ familyId: 'fam-x', familyName: 'Ghost', status: 'deleted', verified: false, governedKidsCount: 0 }),
        ],
        hasMore: false,
      },
    ];
    renderPage();

    expect(await screen.findByText('Ghost')).toBeInTheDocument();
    expect(screen.queryByText(/governed kid/)).not.toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
  });

  it('sends search, status, and verified filters in the callable payload', async () => {
    renderPage();
    await screen.findByText('Dupont');

    fireEvent.change(screen.getByPlaceholderText(/search by family/i), {
      target: { value: 'dup' },
    });
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1].payload).toEqual({ searchQuery: 'dup' });

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'active' } });
    await waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls()[2].payload).toEqual({ searchQuery: 'dup', statusFilter: 'active' });

    fireEvent.change(screen.getByLabelText(/verification/i), { target: { value: 'verified' } });
    await waitFor(() => expect(calls()).toHaveLength(4));
    expect(calls()[3].payload).toEqual({
      searchQuery: 'dup',
      statusFilter: 'active',
      verifiedFilter: true,
    });
  });

  it('maps the unverified filter option to verifiedFilter: false', async () => {
    renderPage();
    await screen.findByText('Dupont');

    fireEvent.change(screen.getByLabelText(/verification/i), { target: { value: 'unverified' } });
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1].payload).toEqual({ verifiedFilter: false });
  });

  it('expands a row to show the full parent list with status and preferred count', async () => {
    renderPage();
    await screen.findByText('Dupont');

    expect(screen.queryByText(/preferred babysitters: 3/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /details/i }));

    expect(screen.getByText(/preferred babysitters: 3/i)).toBeInTheDocument();
    // Parent status only appears in the expanded detail
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('load more pages with the last row as cursor and appends (non-optimistic)', async () => {
    h.pages = [
      { families: [family()], hasMore: true },
      {
        families: [family({ familyId: 'fam-martin', familyName: 'Martin', governedKidsCount: 0 })],
        hasMore: false,
      },
    ];
    renderPage();
    await screen.findByText('Dupont');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Martin')).toBeInTheDocument();
    // Appended, not replaced
    expect(screen.getByText('Dupont')).toBeInTheDocument();
    expect(calls()[1].payload).toEqual({ startAfterId: 'fam-dupont' });
    // hasMore false on the second page hides the button
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('clicking the name header flips the sort order', async () => {
    h.pages = [
      {
        families: [
          family(),
          family({ familyId: 'fam-abel', familyName: 'Abel' }),
        ],
        hasMore: false,
      },
    ];
    renderPage();
    await screen.findByText('Dupont');

    const rowNames = () => {
      const [, ...body] = screen.getAllByRole('row');
      return body.map((tr) => tr.querySelector('td p')?.textContent);
    };
    // initialSort: name ascending.
    expect(rowNames()).toEqual(['Abel', 'Dupont']);

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(rowNames()).toEqual(['Dupont', 'Abel']);
  });

  it('shows an empty state when no families match', async () => {
    h.pages = [{ families: [], hasMore: false }];
    renderPage();

    expect(await screen.findByText(/no families found/i)).toBeInTheDocument();
  });

  it('a failed load shows an error banner, not the empty state', async () => {
    h.failNext = true;
    h.pages = [{ families: [], hasMore: false }];
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load families/i);
    expect(screen.queryByText(/no families found/i)).not.toBeInTheDocument();
  });

  it('double-clicking load more issues a single request (in-flight guard)', async () => {
    h.pages = [
      { families: [family()], hasMore: true },
      {
        families: [family({ familyId: 'fam-martin', familyName: 'Martin' })],
        hasMore: false,
      },
    ];
    renderPage();
    await screen.findByText('Dupont');

    const btn = screen.getByRole('button', { name: /load more/i });
    fireEvent.click(btn);
    fireEvent.click(btn);

    await screen.findByText('Martin');
    // One initial fetch + ONE load-more, despite the double click.
    expect(calls()).toHaveLength(2);
    expect(screen.getAllByText('Martin')).toHaveLength(1);
  });
});
