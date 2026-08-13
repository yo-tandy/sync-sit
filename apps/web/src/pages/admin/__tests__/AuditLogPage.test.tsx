import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

const h = vi.hoisted(() => ({
  logs: [] as Record<string, unknown>[],
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => () => {
    if (name === 'listAuditLogs') {
      return Promise.resolve({ data: { logs: [...h.logs] } });
    }
    return Promise.resolve({ data: { success: true } });
  },
}));

import i18n from '@/i18n';
import { AdminAuditLogPage } from '../AuditLogPage';
import { useAdminStore } from '@/stores/adminStore';

function log(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    adminUserId: 'admin-1',
    action: 'block_user',
    targetUserId: 'user-1',
    details: { reason: 'spam' },
    timestamp: '2026-08-01T10:00:00.000Z',
    adminInfo: { email: 'root@ejm.org', name: 'Root Admin', role: 'admin' },
    targetInfo: { email: 'kid@ejm.org', name: 'Some Kid', role: 'babysitter' },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminAuditLogPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** Action-cell text of each body row, in document order. */
function rowActions() {
  const [, ...body] = screen.getAllByRole('row');
  return body.map((tr) => tr.querySelectorAll('td')[2]?.textContent);
}

beforeEach(() => {
  i18n.changeLanguage('en');
  h.logs = [
    log({ id: 'l-old', action: 'old_action', timestamp: '2026-07-01T10:00:00.000Z' }),
    log({ id: 'l-new', action: 'new_action', timestamp: '2026-08-01T10:00:00.000Z' }),
  ];
  // The zustand store is a module-level singleton — reset between tests.
  useAdminStore.setState({ auditLogs: [], auditLogsLoading: false });
});
afterEach(() => cleanup());

describe('AdminAuditLogPage — table idiom', () => {
  it('renders newest-first by default and flips on timestamp header click', async () => {
    renderPage();

    expect(await screen.findByText('old_action')).toBeInTheDocument();
    expect(rowActions()).toEqual(['new_action', 'old_action']);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.table.timestamp') }));
    expect(rowActions()).toEqual(['old_action', 'new_action']);
  });

  it('renders admin name + email, target name, and formatted details', async () => {
    h.logs = [log()];
    renderPage();

    expect(await screen.findByText('Root Admin')).toBeInTheDocument();
    expect(screen.getByText('root@ejm.org')).toBeInTheDocument();
    expect(screen.getByText('Some Kid')).toBeInTheDocument();
    expect(screen.getByText('reason=spam')).toBeInTheDocument();
  });
});
