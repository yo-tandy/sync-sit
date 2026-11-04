import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  callable: vi.fn(),
  call: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    h.callable(name);
    return h.call;
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { logout: () => Promise<void> }) => unknown) =>
    selector ? selector({ logout: h.logout }) : { logout: h.logout },
}));
vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useNavigate: () => h.navigate,
}));

import i18n from '@/i18n';
import { HelpPage } from '../HelpPage';

function renderHelp() {
  render(
    <MemoryRouter initialEntries={['/account/help']}>
      <I18nextProvider i18n={i18n}>
        <HelpPage />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

function openDeleteDialog() {
  renderHelp();
  fireEvent.click(screen.getByText('Delete my account'));
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
}

describe('HelpPage (the account hub footer\'s Help)', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.navigate.mockReset();
    h.callable.mockReset();
    h.call.mockReset();
    h.logout.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('lists the six entries in the owner\'s order', () => {
    renderHelp();
    const rows = screen
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'About',
      'Privacy Policy',
      'Terms & Conditions',
      'Send Feedback',
      'Report a Problem',
      'Delete my account',
    ]);
  });

  it('opens About, Privacy, Terms and Report inside the hub', () => {
    renderHelp();
    const expected: Array<[string, string]> = [
      ['About', '/account/help/about'],
      ['Privacy Policy', '/account/help/privacy'],
      ['Terms & Conditions', '/account/help/terms'],
      ['Report a Problem', '/account/help/report'],
    ];
    for (const [label, path] of expected) {
      fireEvent.click(screen.getByText(label));
      expect(h.navigate).toHaveBeenLastCalledWith(path);
    }
  });

  it('goes back to the hub', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.navigate).toHaveBeenCalledWith('/account');
  });

  it('calls deleteMyAccount with the fixed confirmation token, then signs out, then lands on /account-deleted', async () => {
    h.call.mockResolvedValue(undefined);
    openDeleteDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/account-deleted'));
    expect(h.callable).toHaveBeenCalledWith('deleteMyAccount');
    expect(h.callable).toHaveBeenCalledTimes(1);
    expect(h.call).toHaveBeenCalledWith({ confirm: 'DELETE' });
    expect(h.logout).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and never signs out when the deletion fails', async () => {
    h.call.mockRejectedValue(Object.assign(new Error('boom'), { code: 'functions/internal' }));
    openDeleteDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(h.logout).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalledWith('/account-deleted');
  });
});
