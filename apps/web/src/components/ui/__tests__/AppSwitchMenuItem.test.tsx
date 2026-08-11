import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

const h = vi.hoisted(() => ({ callable: vi.fn(), assign: vi.fn() }));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import i18n from '@/i18n';
import { AppSwitchMenuItem } from '../AppSwitchMenuItem';

function renderItem() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AppSwitchMenuItem />
    </I18nextProvider>,
  );
}

describe('AppSwitchMenuItem (sit → study)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  // apps/web's vitest setup does not auto-cleanup (globals: false).
  afterEach(() => cleanup());

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
    renderItem();

    fireEvent.click(screen.getByRole('button', { name: /open sync-study/i }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.callable).toHaveBeenCalledWith('createAppHandoffCode', {});
    // The fragment pin: #code=… (never a query param — fragments never reach
    // servers or logs), URL-encoded, on the prod study origin by default.
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=en',
    );
  });

  it('carries fr when the app language is French (incl. regional variants)', async () => {
    await i18n.changeLanguage('fr');
    h.callable.mockResolvedValue({ data: { code: 'abc+/=' } });
    renderItem();

    fireEvent.click(screen.getByRole('button', { name: /ouvrir sync-study/i }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith('https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=fr');
  });

  it('is non-optimistic: disabled while the callable is in flight', async () => {
    let resolveCall!: (v: { data: { code: string } }) => void;
    h.callable.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderItem();

    const button = screen.getByRole('button', { name: /open sync-study/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(h.assign).not.toHaveBeenCalled();

    resolveCall({ data: { code: 'late' } });
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });

  it('shows an error and re-enables on callable failure (no navigation)', async () => {
    h.callable.mockRejectedValue(new Error('boom'));
    renderItem();

    const button = screen.getByRole('button', { name: /open sync-study/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText(/could not switch apps/i)).toBeInTheDocument(),
    );
    expect(button).toBeEnabled();
    expect(h.assign).not.toHaveBeenCalled();
  });
});
