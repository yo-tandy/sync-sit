import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock: the REAL adminStore runs against it.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  users: [] as Record<string, unknown>[],
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'listUsers') {
      return Promise.resolve({ data: { users: [...h.users] } });
    }
    return Promise.resolve({ data: { success: true } });
  },
}));

import i18n from '@/i18n';
import { AdminUsersPage } from '../UsersPage';
import { useAdminStore } from '@/stores/adminStore';

function user(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'u1',
    firstName: 'Anna',
    lastName: 'Albert',
    email: 'anna@test.com',
    role: 'parent',
    status: 'active',
    createdAt: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** Name-cell text of each body row, in document order. */
function rowNames() {
  const [, ...body] = screen.getAllByRole('row');
  return body.map((tr) => tr.querySelector('td p')?.textContent?.trim());
}

beforeEach(() => {
  i18n.changeLanguage('en');
  h.calls.length = 0;
  h.users = [
    user({ uid: 'u-z', firstName: 'Zoe', lastName: 'Zebra', email: 'zoe@test.com' }),
    user({ uid: 'u-a', firstName: 'Anna', lastName: 'Albert', email: 'anna@test.com' }),
  ];
  // The zustand store is a module-level singleton — reset between tests.
  useAdminStore.setState({ users: [], usersLoading: false });
});
afterEach(() => cleanup());

describe('AdminUsersPage — table idiom', () => {
  it('renders users sorted by name ascending regardless of wire order', async () => {
    renderPage();

    expect(await screen.findByText('zoe@test.com')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Anna Albert', 'Zoe Zebra']);
  });

  it('clicking the name header flips the sort order', async () => {
    renderPage();
    await screen.findByText('zoe@test.com');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.table.name') }));

    expect(rowNames()).toEqual(['Zoe Zebra', 'Anna Albert']);
    expect(screen.getByRole('columnheader', { name: i18n.t('admin.table.name') })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});
