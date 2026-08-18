import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// REAL shared-ui here (unlike the orchestrator suite): this pins the two
// issue-#154 ledger items through the actual components — (1) the code-entry
// step always renders the no-code login exit hint, and (2) the real email
// step's send path calls verifyParentEmail with the study app hint.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return Promise.resolve({ data: {} });
  },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: () => Promise.resolve(),
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = (() => ({
    firebaseUser: null,
    userDoc: null,
    loading: false,
    refreshUserDoc: () => Promise.resolve(),
  })) as unknown as {
    (): unknown;
    getState: () => unknown;
    subscribe: (fn: (s: unknown) => void) => () => void;
  };
  useAuthStore.getState = () => ({ loading: false, firebaseUser: null, userDoc: null });
  useAuthStore.subscribe = () => () => {};
  return { useAuthStore };
});

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { ParentEnrollment } from '../ParentEnrollment';

beforeEach(() => {
  h.calls.length = 0;
});

async function driveToVerifyStep() {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ParentEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByLabelText(i18n.t('enrollment.emailLabel')), {
    target: { value: 'claire@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.sendCode') }));
  // Landing on the verify step proves the send resolved.
  expect(await screen.findByText(i18n.t('auth.checkEmail'))).toBeInTheDocument();
}

describe('ParentEnrollment verify step (real components, issue #154)', () => {
  it('sends the code via verifyParentEmail with the study app hint', async () => {
    await driveToVerifyStep();

    const call = h.calls.find((c) => c.name === 'verifyParentEmail');
    expect(call).toBeTruthy();
    expect(call!.payload).toMatchObject({ email: 'claire@example.com', app: 'study' });
  });

  it('always renders the no-code exit hint with a /login link under the code entry', async () => {
    await driveToVerifyStep();

    // Static, non-distinguishing exit for users whose account already exists
    // and who therefore never get a code (silent existing-account flow,
    // issue #148) — rendered unconditionally.
    expect(screen.getByText(/If you already have an account/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'log in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});
