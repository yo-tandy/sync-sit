import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => () =>
    Promise.resolve({
      data: {
        babysitterCount: 3,
        familyCount: 2,
        appointmentCount: 5,
        pendingVerificationCount: 0,
      },
    }),
}));

import i18n from '@/i18n';
import { AdminDashboard } from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('AdminDashboard', () => {
  it('renders the three nav groups as headings', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trust & safety' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeInTheDocument();
  });

  it('links every admin surface, including governance and enrollment access', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'People' });

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const to of [
      '/admin/users',
      '/admin/families',
      '/admin/verifications',
      '/admin/enrollment-access',
      '/admin/governance',
      '/admin/appointments',
      '/admin/holidays',
      '/admin/audit-log',
      '/admin/gdpr-export',
    ]) {
      expect(links).toContain(to);
    }
  });
});
