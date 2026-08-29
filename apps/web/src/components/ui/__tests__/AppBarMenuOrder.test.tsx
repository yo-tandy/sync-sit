import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { AppBar } from '../AppBar';

/**
 * The parent menu's ORDER is the deliverable of issue #339 -- the owner
 * specified five sections and their sequence, so the pins assert the
 * SEQUENCE, not mere presence (presence passed before the reorder too).
 */
function openParentMenu() {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role="parent" />
      </MemoryRouter>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getAllByRole('button')[0]);
}

/** Menu entries in DOM order, as a caller sees them top to bottom. */
function menuLabels(): string[] {
  const dialog = document.querySelector('[role="dialog"]') ?? document.body;
  return [...dialog.querySelectorAll('a, button')]
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

describe('parent menu order (issue #339)', () => {
  it('renders the owner section order: identity -> activity -> cross-app -> support/legal -> sign out', () => {
    openParentMenu();
    const labels = menuLabels();
    const at = (needle: string) => labels.findIndex((l) => l.includes(needle));

    // Section 1, in order.
    expect(at(i18n.t('menu.myAccount'))).toBeGreaterThanOrEqual(0);
    expect(at(i18n.t('menu.myAccount'))).toBeLessThan(at(i18n.t('menu.myFamily')));
    expect(at(i18n.t('menu.myFamily'))).toBeLessThan(at(i18n.t('governance.menuTitle')));
    expect(at(i18n.t('governance.menuTitle'))).toBeLessThan(at(i18n.t('verification.menuTitle')));

    // Section 2 follows section 1, in order.
    expect(at(i18n.t('verification.menuTitle'))).toBeLessThan(at(i18n.t('menu.myAppointments')));
    expect(at(i18n.t('menu.myAppointments'))).toBeLessThan(at(i18n.t('menu.myReferences')));
    expect(at(i18n.t('menu.myReferences'))).toBeLessThan(at(i18n.t('menu.preferredBabysitters')));

    // Section 3 (share + cross-app) comes AFTER activity and BEFORE legal --
    // the reversal the issue calls out.
    expect(at(i18n.t('menu.preferredBabysitters'))).toBeLessThan(at(i18n.t('share.title')));
    expect(at(i18n.t('share.title'))).toBeLessThan(at(i18n.t('menu.sendFeedback')));

    // Section 4, then sign out last of all.
    expect(at(i18n.t('menu.sendFeedback'))).toBeLessThan(at(i18n.t('menu.about')));
    expect(at(i18n.t('menu.about'))).toBeLessThan(at(i18n.t('menu.privacyPolicy')));
    expect(at(i18n.t('menu.privacyPolicy'))).toBeLessThan(at(i18n.t('menu.terms')));
    expect(at(i18n.t('common.signOut'))).toBe(labels.length - 1);
    cleanup();
  });

  it('offers the language selector to parents, not just admins (issue #339 section 3)', () => {
    openParentMenu();
    // LanguageSelector renders the two language buttons.
    expect(screen.getByRole('button', { name: /english/i })).toBeInTheDocument();
    cleanup();
  });

  it('no longer lists co-parent: it lives inside family settings (issue #340)', () => {
    openParentMenu();
    // Scoped to the menu dialog: the md+ NavTabs row renders the same
    // destinations, so an unscoped query matches twice.
    const labels = menuLabels();
    expect(labels.some((l) => l.includes(i18n.t('menu.coParent')))).toBe(false);
    // ...and family settings is still there, which is where it moved to.
    expect(labels.some((l) => l.includes(i18n.t('menu.myFamily')))).toBe(true);
    cleanup();
  });
});
