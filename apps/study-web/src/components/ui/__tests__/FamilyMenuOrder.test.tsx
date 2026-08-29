import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, next: (snap: { docs: [] }) => void) => { next({ docs: [] }); return () => {}; },
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    firebaseUser: { uid: 'p1' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import i18n from '@/i18n';
import { FamilyAppBar } from '../FamilyAppBar';

/**
 * Issue #339: the owner specified the family menu's five sections and
 * their order, identically for both apps. These pins assert the SEQUENCE
 * (presence passed before the reorder), and the sit twin lives at
 * apps/web/src/components/ui/__tests__/AppBarMenuOrder.test.tsx -- the two
 * portals are supposed to match, so both are pinned.
 */
function openMenu() {
  renderWithProviders(<FamilyAppBar />);
  fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
}

function menuLabels(): string[] {
  const dialog = document.querySelector('[role="dialog"]') ?? document.body;
  return [...dialog.querySelectorAll('a, button')]
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

describe('study family menu order (issue #339)', () => {
  it('renders identity -> activity -> cross-app -> support/legal -> sign out', () => {
    openMenu();
    const labels = menuLabels();
    const at = (needle: string) => labels.findIndex((l) => l.includes(needle));

    expect(at(i18n.t('family.accountTitle'))).toBeGreaterThanOrEqual(0);
    expect(at(i18n.t('family.accountTitle'))).toBeLessThan(at(i18n.t('family.settingsTitle')));
    expect(at(i18n.t('family.settingsTitle'))).toBeLessThan(at(i18n.t('family.governance.navTitle')));
    expect(at(i18n.t('family.governance.navTitle'))).toBeLessThan(at(i18n.t('family.verification.menuTitle')));

    expect(at(i18n.t('family.verification.menuTitle'))).toBeLessThan(at(i18n.t('family.requestsTitle')));
    expect(at(i18n.t('family.requestsTitle'))).toBeLessThan(at(i18n.t('family.sessions.title')));
    expect(at(i18n.t('family.sessions.title'))).toBeLessThan(at(i18n.t('family.endorsements.menuTitle')));

    // Cross-app section moves BEFORE support/legal -- the reversal the
    // issue asks for; study previously rendered legal first.
    expect(at(i18n.t('family.endorsements.menuTitle'))).toBeLessThan(at(i18n.t('share.title')));
    expect(at(i18n.t('share.title'))).toBeLessThan(at(i18n.t('menu.sendFeedback')));
    expect(at(i18n.t('menu.sendFeedback'))).toBeLessThan(at(i18n.t('menu.about')));
    expect(at(i18n.t('menu.about'))).toBeLessThan(at(i18n.t('menu.privacyPolicy')));
    expect(at(i18n.t('menu.privacyPolicy'))).toBeLessThan(at(i18n.t('menu.terms')));
    expect(at(i18n.t('common.signOut'))).toBe(labels.length - 1);
    cleanup();
  });

  it('carries a Send feedback entry, matching sit (issue #339 section 4)', () => {
    openMenu();
    expect(menuLabels().some((l) => l.includes(i18n.t('menu.sendFeedback')))).toBe(true);
    cleanup();
  });
});
