import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

const h = vi.hoisted(() => ({
  appointments: [] as Record<string, unknown>[],
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => () => {
    if (name === 'listAppointments') {
      return Promise.resolve({ data: { appointments: [...h.appointments] } });
    }
    return Promise.resolve({ data: { success: true } });
  },
}));

import i18n from '@/i18n';
import { AdminAppointmentsPage } from '../AppointmentsPage';
import { useAdminStore } from '@/stores/adminStore';

function appt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    status: 'confirmed',
    date: '2026-08-01',
    startTime: '18:00',
    endTime: '21:00',
    type: 'one_time',
    offeredRate: 15,
    babysitterName: 'Lea Blanc',
    familyName: 'Dupont',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AdminAppointmentsPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** Date-cell text of each body row, in document order. */
function rowDates() {
  const [, ...body] = screen.getAllByRole('row');
  return body.map((tr) => tr.querySelector('td')?.textContent);
}

beforeEach(() => {
  i18n.changeLanguage('en');
  h.appointments = [
    appt({ id: 'a-old', date: '2026-07-01' }),
    appt({ id: 'a-new', date: '2026-08-01' }),
  ];
  // The zustand store is a module-level singleton — reset between tests.
  useAdminStore.setState({ appointments: [], appointmentsLoading: false });
});
afterEach(() => cleanup());

describe('AdminAppointmentsPage — table idiom', () => {
  it('renders newest-first by default and flips on date header click', async () => {
    renderPage();

    expect(await screen.findByText('2026-07-01')).toBeInTheDocument();
    expect(rowDates()).toEqual(['2026-08-01', '2026-07-01']);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.table.date') }));
    expect(rowDates()).toEqual(['2026-07-01', '2026-08-01']);
  });

  it('renders time, rate, and status for a row', async () => {
    h.appointments = [appt()];
    renderPage();

    expect(await screen.findByText('18:00–21:00')).toBeInTheDocument();
    expect(screen.getByText('15€/h')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });
});
