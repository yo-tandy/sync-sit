import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

// Hoisted shared state the mocks record into.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: (..._a: unknown[]) => {},
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return Promise.resolve({ data: { uid: 'u1' } });
  },
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));

// Lightweight stand-ins for the child step components: each exposes a button
// that fires its callback so we can drive the orchestrator deterministically.
vi.mock('@ejm/shared-ui', () => ({
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
  StepEmail: ({ onSubmit }: { onSubmit: () => void }) => (
    <button onClick={onSubmit}>email-submit</button>
  ),
  StepVerify: ({ onVerify }: { onVerify: (c: string) => void }) => (
    <button onClick={() => onVerify('123456')}>verify-submit</button>
  ),
  StepPassword: ({ onSubmit }: { onSubmit: (pw: string) => void }) => (
    <button onClick={() => onSubmit('Pw123456!')}>password-submit</button>
  ),
}));
vi.mock('@/components/ui/EnrollmentAppBar', () => ({
  EnrollmentAppBar: () => <div>enrollment-app-bar</div>,
}));
vi.mock('../StepProfile', () => ({
  StepProfile: ({ onNext }: { onNext: (d: unknown) => void }) => (
    <button onClick={() => onNext({ firstName: 'Flow', lastName: 'Tutor', dateOfBirth: '2008-07-07', classLevel: 'Terminale', gender: 'other' })}>
      profile-next
    </button>
  ),
}));
vi.mock('../StepPrefs', () => ({
  StepPrefs: ({ onNext }: { onNext: (d: unknown) => void }) => (
    <button onClick={() => onNext({ sessionLengthsMin: [60], locationPrefs: ['online'], paddingMin: 0, contactEmail: 'flow@ejm.org', areaMode: 'arrondissement' })}>
      prefs-next
    </button>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import i18n from '@/i18n';
import { TutorEnrollment } from '../TutorEnrollment';

function renderFlow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TutorEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  h.calls.length = 0;
  h.navigate = vi.fn();
});

describe('TutorEnrollment orchestrator', () => {
  it('starts on the email step with the auth-phase chrome (TopNav + StepIndicator)', () => {
    renderFlow();
    expect(screen.getByText('email-submit')).toBeInTheDocument();
    expect(screen.getByText('step-0')).toBeInTheDocument();
    expect(screen.queryByText('enrollment-app-bar')).toBeNull();
  });

  it('drives through all steps and submits enrollTutor, then navigates to success', async () => {
    renderFlow();

    fireEvent.click(screen.getByText('email-submit'));
    expect(await screen.findByText('verify-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyEjmEmail');

    fireEvent.click(screen.getByText('verify-submit'));
    expect(await screen.findByText('password-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyCode');

    // Step 2 -> 3 crosses into the post-auth phase: app bar replaces TopNav.
    fireEvent.click(screen.getByText('password-submit'));
    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.getByText('enrollment-app-bar')).toBeInTheDocument();
    expect(screen.queryByText(/step-\d/)).toBeNull();

    fireEvent.click(screen.getByText('profile-next'));
    fireEvent.click(await screen.findByText('prefs-next'));

    // enrollTutor called with the composed payload; success navigation fired.
    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollTutor');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as { ejemEmail: string; verificationCode: string; password: string; enrollment: Record<string, unknown> };
    expect(payload.verificationCode).toBe('123456');
    expect(payload.password).toBe('Pw123456!');
    expect(payload.enrollment).toMatchObject({
      firstName: 'Flow', classLevel: 'Terminale',
      sessionLengthsMin: [60], locationPrefs: ['online'], contactEmail: 'flow@ejm.org',
    });
    expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } });
  });
});
