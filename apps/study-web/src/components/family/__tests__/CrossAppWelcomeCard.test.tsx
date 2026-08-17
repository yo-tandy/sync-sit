import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { CrossAppWelcomeCard } from '../CrossAppWelcomeCard';

const KEY = 'sync-welcome-seen-study';

// jsdom in this config doesn't expose localStorage — minimal in-memory stub
// (same idiom as sit's DashboardPage.refs.test.tsx).
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

beforeEach(async () => {
  cleanup();
  installLocalStorageStub();
  await i18n.changeLanguage('en');
});

describe('CrossAppWelcomeCard (study)', () => {
  it('renders on first visit', () => {
    renderWithProviders(<CrossAppWelcomeCard />);
    expect(screen.getByText(i18n.t('welcomeCross.parentCard'))).toBeInTheDocument();
  });

  it('dismiss persists to localStorage and hides the card', () => {
    renderWithProviders(<CrossAppWelcomeCard />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcomeCross.dismiss') }));
    expect(screen.queryByText(i18n.t('welcomeCross.parentCard'))).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('never renders again once seen', () => {
    localStorage.setItem(KEY, 'true');
    renderWithProviders(<CrossAppWelcomeCard />);
    expect(screen.queryByText(i18n.t('welcomeCross.parentCard'))).toBeNull();
  });
});
