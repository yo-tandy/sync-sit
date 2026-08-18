import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
  vi.clearAllMocks();
  h.state = { forcedSignOut: false };
  await i18n.changeLanguage('en');
});

describe('ForcedSignOutWatcher (sit)', () => {
  it('on forcedSignOut: shows the signed-out toast, lands on /, acknowledges the flag', () => {
    h.state = { forcedSignOut: true };
    renderWatcher();

    expect(screen.getByText('You have been signed out.')).toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith('/');
    expect(h.acknowledgeForcedSignOut).toHaveBeenCalled();
  });

  it('does nothing while the flag is unset', () => {
    renderWatcher();

    expect(screen.queryByText('You have been signed out.')).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.acknowledgeForcedSignOut).not.toHaveBeenCalled();
  });
});
