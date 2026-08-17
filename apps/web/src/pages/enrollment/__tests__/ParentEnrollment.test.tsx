import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup } from '@testing-library/react';

// Issue #148: the verify call must carry the sit app hint — it selects the
// copy of the silent account-exists email. A dropped hint fails silently
// (normalizeAccountExistsApp collapses anything unrecognized to 'sit'), so
// this pin is the only guard. Mirrors the babysitter/tutor wizard pins.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
}));

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return Promise.resolve({ data: { success: true } });
  },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(() => Promise.resolve()),
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => {
  const storeState = () => ({
    firebaseUser: null,
    userDoc: null,
    loading: false,
    refreshUserDoc: () => Promise.resolve(),
  });
  return {
    useAuthStore: Object.assign(() => storeState(), {
      getState: () => storeState(),
      subscribe: () => () => {},
    }),
  };
});
vi.mock('@ejm/sit-core', () => ({
  getParentProfile: (userDoc: { profiles?: { parent?: unknown } } | null) =>
    userDoc?.profiles?.parent ?? null,
}));
vi.mock('@ejm/shared-ui', () => ({
  enrollmentErrorReason: () => null,
}));
vi.mock('@/components/ui', () => ({
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
}));
vi.mock('../parent/StepParentEmail', () => ({
  StepParentEmail: ({ onNext }: { onNext: () => void }) => (
    <button onClick={onNext}>parent-email-submit</button>
  ),
}));
vi.mock('../parent/StepParentVerify', () => ({
  StepParentVerify: () => <div>parent-verify-step</div>,
}));
vi.mock('../parent/StepParentPassword', () => ({
  StepParentPassword: () => <div>parent-password-step</div>,
}));
vi.mock('../parent/StepFamilyInfo', () => ({
  StepFamilyInfo: () => <div>family-info-step</div>,
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { ParentEnrollment } from '../ParentEnrollment';

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
});

describe('ParentEnrollment verify payload (issue #148)', () => {
  it('verifyParentEmail is called with the sit app hint', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ParentEnrollment />
        </MemoryRouter>
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByText('parent-email-submit'));
    await vi.waitFor(() => {
      const call = h.calls.find((c) => c.name === 'verifyParentEmail');
      expect(call).toBeTruthy();
      expect(call!.payload).toMatchObject({ app: 'sit' });
    });
    // The send advanced the wizard to the verify step.
    expect(await screen.findByText('parent-verify-step')).toBeInTheDocument();
  });
});
