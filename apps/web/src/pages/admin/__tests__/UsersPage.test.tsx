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

describe('AdminUsersPage — identity-correction dialog (issue #158)', () => {
  beforeEach(() => {
    h.users = [
      user({
        uid: 'u-i',
        firstName: 'Typoed',
        lastName: 'Name',
        dateOfBirth: '2010-04-01T00:00:00.000Z',
      }),
    ];
  });

  it('opens prefilled with the current root identity; save disabled until a change', async () => {
    // Server-written DOBs (redeemKidInvite, this callable's own writes) come
    // through the callable serializer as an Admin-SDK envelope, not an ISO
    // string — the prefill must handle that shape too.
    h.users = [
      user({
        uid: 'u-i',
        firstName: 'Typoed',
        lastName: 'Name',
        dateOfBirth: { _seconds: 1270080000, _nanoseconds: 0 }, // 2010-04-01T00:00:00Z
      }),
    ];
    renderPage();
    await screen.findByText('Typoed Name');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.correctIdentity') }));

    expect(screen.getByLabelText(i18n.t('admin.identityFirstName'))).toHaveValue('Typoed');
    expect(screen.getByLabelText(i18n.t('admin.identityLastName'))).toHaveValue('Name');
    expect(screen.getByLabelText(i18n.t('admin.identityDob'))).toHaveValue('2010-04-01');
    // Nothing changed yet — save is disabled.
    expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeDisabled();
  });

  it('blanking a populated field shows the cannot-be-empty hint and keeps save disabled', async () => {
    renderPage();
    await screen.findByText('Typoed Name');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.correctIdentity') }));
    fireEvent.change(screen.getByLabelText(i18n.t('admin.identityFirstName')), {
      target: { value: 'Fixed' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('admin.identityLastName')), {
      target: { value: '   ' },
    });

    expect(screen.getByText(i18n.t('admin.identityCannotBeEmpty'))).toBeInTheDocument();
    // Even with another valid change pending, save stays disabled — the
    // blanked field would otherwise be silently dropped.
    expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeDisabled();
  });

  it('sends ONLY the changed field, closes, and reloads the list', async () => {
    renderPage();
    await screen.findByText('Typoed Name');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.correctIdentity') }));
    fireEvent.change(screen.getByLabelText(i18n.t('admin.identityFirstName')), {
      target: { value: 'Fixed' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));

    const call = await vi.waitFor(() => {
      const found = h.calls.find((c) => c.name === 'correctUserIdentity');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(call.payload).toEqual({ targetUserId: 'u-i', firstName: 'Fixed' });

    // The dialog closes and the list reloads.
    await vi.waitFor(() => {
      expect(screen.queryByLabelText(i18n.t('admin.identityFirstName'))).toBeNull();
      expect(h.calls.filter((c) => c.name === 'listUsers').length).toBeGreaterThanOrEqual(2);
    });
  });
});
