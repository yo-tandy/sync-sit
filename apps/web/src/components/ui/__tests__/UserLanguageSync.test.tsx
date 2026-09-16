import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { emitUserLanguageChange } from '@ejm/shared-ui';

const h = vi.hoisted(() => ({
  updateDoc: vi.fn(() => Promise.resolve()),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
  state: { firebaseUser: null } as Record<string, unknown>,
}));

vi.mock('firebase/firestore', () => ({
  updateDoc: h.updateDoc,
  doc: h.doc,
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(h.state),
}));

import i18n from '@/i18n';
import { UserLanguageSync } from '../UserLanguageSync';

function renderSync() {
  return render(
    <I18nextProvider i18n={i18n}>
      <UserLanguageSync />
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  h.state = { firebaseUser: null };
  await i18n.changeLanguage('en');
});

describe('UserLanguageSync', () => {
  it("writes { language, updatedAt } to the signed-in user's own doc on an explicit language pick (issue #512)", async () => {
    h.state = { firebaseUser: { uid: 'u1' } };
    renderSync();
    expect(h.updateDoc).not.toHaveBeenCalled(); // never on mount

    await act(async () => {
      emitUserLanguageChange('fr');
    });
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    expect(h.updateDoc).toHaveBeenCalledWith(
      { path: 'users/u1' },
      { language: 'fr', updatedAt: 'SERVER_TS' },
    );
  });

  it('a PROGRAMMATIC i18n switch (HandoffPage applying a minted lang, bootstrap) writes nothing — it cannot be attributed to this session', async () => {
    h.state = { firebaseUser: { uid: 'someone-else-still-signed-in' } };
    renderSync();
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('writes nothing while signed out', async () => {
    renderSync();
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});
