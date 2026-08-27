import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Admin Configuration page (issue #250): rows render from the SERVER's
 * definition table, save sends only the CHANGED keys, and out-of-bounds
 * drafts block the save client-side (the callable re-validates for real).
 */
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  getResult: {
    defs: {
      publishedSearchMaxActive: {
        default: 3, min: 1, max: 20,
        description: 'Live demand-board posts per family.',
      },
      boardContactsPerDay: {
        default: 5, min: 1, max: 50,
        description: 'Board contacts per window.',
      },
    },
    values: { publishedSearchMaxActive: 5 } as Record<string, number>,
  },
  updateError: null as unknown,
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'getAdminConfig') return Promise.resolve({ data: h.getResult });
    if (h.updateError) return Promise.reject(h.updateError);
    return Promise.resolve({ data: { success: true } });
  },
}));

import '@/i18n';
import { AdminConfigurationPage } from '../ConfigurationPage';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <AdminConfigurationPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  h.calls.length = 0;
  h.updateError = null;
});

afterEach(cleanup);

describe('AdminConfigurationPage', () => {
  it('renders every key from the server definition table with bounds and override state', async () => {
    renderPage();
    expect(await screen.findByText('publishedSearchMaxActive')).toBeInTheDocument();
    expect(screen.getByText('boardContactsPerDay')).toBeInTheDocument();
    // Overridden key shows its stored value; un-overridden shows the default note.
    expect((screen.getByLabelText('publishedSearchMaxActive') as HTMLInputElement).value).toBe('5');
    expect(screen.getAllByText(/using default/).length).toBe(1);
  });

  it('saves ONLY the changed keys', async () => {
    renderPage();
    await screen.findByText('publishedSearchMaxActive');
    fireEvent.change(screen.getByLabelText('boardContactsPerDay'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const update = h.calls.find((c) => c.name === 'updateAdminConfig');
      expect(update).toBeTruthy();
      // publishedSearchMaxActive is untouched (still 5) and must not ride along.
      expect(update!.payload).toEqual({ updates: { boardContactsPerDay: 10 } });
    });
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
  });

  it('an out-of-bounds draft shows the bounds error and disables save', async () => {
    renderPage();
    await screen.findByText('publishedSearchMaxActive');
    fireEvent.change(screen.getByLabelText('publishedSearchMaxActive'), { target: { value: '21' } });
    expect(screen.getByText(/integer between 1 and 20/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(h.calls.some((c) => c.name === 'updateAdminConfig')).toBe(false);
  });

  it('surfaces a save failure', async () => {
    h.updateError = new Error('denied');
    renderPage();
    await screen.findByText('publishedSearchMaxActive');
    fireEvent.change(screen.getByLabelText('boardContactsPerDay'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/Could not save configuration/)).toBeInTheDocument();
  });
});
