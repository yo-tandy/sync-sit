import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { ToastProvider } from '@ejm/shared-ui';

const h = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  acknowledgeForcedSignOut: vi.fn(),
  state: { forcedSignOut: false } as Record<string, unknown>,
}));

vi.mock('@/router', () => ({ router: { navigate: h.navigate } }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ ...h.state, acknowledgeForcedSignOut: h.acknowledgeForcedSignOut }),
}));

import i18n from '@/i18n';
import { ForcedSignOutWatcher } from '../ForcedSignOutWatcher';

function renderWatcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <ForcedSignOutWatcher />
      </ToastProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.clearAllMocks();
  h.state = { forcedSignOut: false };
  await i18n.changeLanguage('en');
});

describe('ForcedSignOutWatcher (study)', () => {
  it('on forcedSignOut: shows the signed-out toast, lands on /, acknowledges the flag', () => {
    h.state = { forcedSignOut: true };
    renderWatcher();

    expect(screen.getByText('You have been signed out on another device.')).toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith('/');
    expect(h.acknowledgeForcedSignOut).toHaveBeenCalled();
  });

  it('holds the announcement until the tab becomes visible again', () => {
    // The receiving tab is by definition the backgrounded one — a toast
    // fired while hidden expires unseen (issue #181 review).
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    h.state = { forcedSignOut: true };
    renderWatcher();

    expect(screen.queryByText('You have been signed out on another device.')).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.acknowledgeForcedSignOut).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByText('You have been signed out on another device.')).toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith('/');
    expect(h.acknowledgeForcedSignOut).toHaveBeenCalled();
  });

  it('does nothing while the flag is unset', () => {
    renderWatcher();

    expect(screen.queryByText('You have been signed out on another device.')).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.acknowledgeForcedSignOut).not.toHaveBeenCalled();
  });
});
