import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ callable: vi.fn(), assign: vi.fn() }));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import { renderWithProviders } from '@/__tests__/test-utils';
import i18n from '@/i18n';
import { AppSwitchMenuItem } from '../AppSwitchMenuItem';

describe('AppSwitchMenuItem (study → sit)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    h.callable.mockReset();
    h.assign.mockReset();
    // jsdom's location.assign is non-functional — replace location wholesale.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: h.assign, hash: '' },
      writable: true,
      configurable: true,
    });
  });

  it('mints a handoff code and navigates with the code in the URL FRAGMENT', async () => {
    h.callable.mockResolvedValue({ data: { code: 'abc+/=' } });
    renderWithProviders(<AppSwitchMenuItem />);

    fireEvent.click(screen.getByRole('button', { name: /open sync-sit/i }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.callable).toHaveBeenCalledWith('createAppHandoffCode', {});
    // The fragment pin: #code=… (never a query param — fragments never reach
    // servers or logs), URL-encoded, on the prod sit origin by default.
    expect(h.assign).toHaveBeenCalledWith('https://sync-sit.web.app/handoff#code=abc%2B%2F%3D&lang=en');
  });

  it('carries fr when the app language is French (incl. regional variants)', async () => {
    await i18n.changeLanguage('fr');
    h.callable.mockResolvedValue({ data: { code: 'abc+/=' } });
    renderWithProviders(<AppSwitchMenuItem />);

    fireEvent.click(screen.getByRole('button', { name: /ouvrir sync-sit/i }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith('https://sync-sit.web.app/handoff#code=abc%2B%2F%3D&lang=fr');
    await i18n.changeLanguage('en');
  });

  it('is non-optimistic: disabled while the callable is in flight', async () => {
    let resolveCall!: (v: { data: { code: string } }) => void;
    h.callable.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderWithProviders(<AppSwitchMenuItem />);

    const button = screen.getByRole('button', { name: /open sync-sit/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(h.assign).not.toHaveBeenCalled();

    resolveCall({ data: { code: 'late' } });
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });

  it('shows an error and re-enables on callable failure (no navigation)', async () => {
    h.callable.mockRejectedValue(new Error('boom'));
    renderWithProviders(<AppSwitchMenuItem />);

    const button = screen.getByRole('button', { name: /open sync-sit/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText(/could not switch apps/i)).toBeInTheDocument(),
    );
    expect(button).toBeEnabled();
    expect(h.assign).not.toHaveBeenCalled();
  });
});
