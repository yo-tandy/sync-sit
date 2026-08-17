import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

// The @/components/ui barrel pulls in the auth store at module scope.
vi.mock('@/stores/authStore', () => {
  const state = { firebaseUser: null, userDoc: null, loading: false };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { CrossAppWelcomeCard } from '../CrossAppWelcomeCard';

const KEY = 'sync-welcome-seen-sit';

// jsdom in this config doesn't expose localStorage — minimal in-memory stub
// (same idiom as DashboardPage.refs.test.tsx).
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
}

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <CrossAppWelcomeCard />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  cleanup();
  installLocalStorageStub();
  i18n.changeLanguage('en');
});

describe('CrossAppWelcomeCard (sit)', () => {
  it('renders on first visit', () => {
    renderCard();
    expect(screen.getByText(i18n.t('welcomeCross.parentCard'))).toBeInTheDocument();
  });

  it('dismiss persists to localStorage and hides the card', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcomeCross.dismiss') }));
    expect(screen.queryByText(i18n.t('welcomeCross.parentCard'))).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('never renders again once seen', () => {
    localStorage.setItem(KEY, 'true');
    renderCard();
    expect(screen.queryByText(i18n.t('welcomeCross.parentCard'))).toBeNull();
  });
});
