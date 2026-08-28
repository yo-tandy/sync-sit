import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => Promise.resolve({ data: { valid: true } }),
}));
// The '@/components/ui' barrel transitively pulls the auth store, which
// subscribes to auth state at module load — stub it out.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(() => ({ firebaseUser: null, userDoc: null, loading: false }), {
    getState: () => ({ firebaseUser: null, userDoc: null, loading: false }),
    subscribe: () => () => {},
  }),
}));

import i18n from '@/i18n';
import { StepParentVerify } from '../StepParentVerify';
import type { ParentFormData } from '../../ParentEnrollment';

// Round 5/6 (issue #148): the code-entry step always renders a static
// "already have an account? log in" exit hint — on BOTH the fresh and the
// silent existing-account paths, so it distinguishes nothing, but it gives a
// silent-path user (who will never receive a code) a way out. The wizard
// test mocks this component out, so the pin lives here (mirrors the study
// StepVerify.test.tsx).
describe('StepParentVerify login hint (issue #148)', () => {
  it('always renders the no-code hint with a /login link', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepParentVerify
            data={{ email: 'parent@test.com', verificationCode: '' } as ParentFormData}
            onChange={() => {}}
            onNext={() => {}}
            onResend={() => {}}
            loading={false}
            error={null}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText(/If you already have an account/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'log in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});

// Issue #250 round 5: the sit parent verify step was the one resend UI left
// hardcoded at 60s -- with verificationCodeCooldownS raised, its button
// re-enabled before the server window ended and the click hit the decoy
// success (silently no email). These pin the prop end of the fix; the page
// wiring is pinned in ParentEnrollment.test.tsx.
describe('StepParentVerify configured resend cooldown (issue #250)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderStep(resendCooldownS?: number) {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepParentVerify
            data={{ email: 'parent@test.com', verificationCode: '' } as ParentFormData}
            onChange={() => {}}
            onNext={() => {}}
            onResend={() => {}}
            loading={false}
            error={null}
            resendCooldownS={resendCooldownS}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('starts the countdown at the configured value, not the code default', () => {
    renderStep(600);
    expect(screen.getByText('Resend in 600s')).toBeInTheDocument();
  });

  it('extends a running countdown when the configured value arrives after mount', async () => {
    const view = renderStep(undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText('Resend in 50s')).toBeInTheDocument();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepParentVerify
            data={{ email: 'parent@test.com', verificationCode: '' } as ParentFormData}
            onChange={() => {}}
            onNext={() => {}}
            onResend={() => {}}
            loading={false}
            error={null}
            resendCooldownS={600}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Resend in 590s')).toBeInTheDocument();
  });
});
