import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';

// Hoisted shared state the mocks record into.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
  // Controllable authStore state — default is signed out so most tests keep
  // the fresh-signup behavior.
  auth: { firebaseUser: null as unknown, userDoc: null as unknown, loading: false },
  refreshUserDoc: () => Promise.resolve(),
  // A successful sign-in settles the store with the signed-in user AND the
  // freshly-written parent doc (models the real store); the navigate gate
  // reads them via getState. Failure paths override per-test: a rejection
  // settles nothing, a doc blip settles only firebaseUser — so the gate
  // fails and the account-ready login state renders (issue #264).
  signIn: vi.fn(() => {
    h.auth.firebaseUser = { uid: 'new' };
    h.auth.userDoc = { profiles: { parent: { familyId: 'fam-1' } } };
    return Promise.resolve();
  }),
  // Listeners registered through the mocked store subscription — tests fire
  // them to model the auth snapshot landing after sign-in.
  subscribers: [] as Array<(s: unknown) => void>,
  // Controllable error reason so tests can drive the specialised notices.
  // There is no account-exists reason (issue #148: silent existing-account
  // flow) — the only reasons are profile-exists and role-exclusive.
  errorReason: null as 'profile-exists' | 'role-exclusive' | null,
  // Controllable raw rejection (no machine-readable reason) so tests can
  // drive the plain-error fallback, e.g. the createUser already-exists race
  // backstop.
  rawError: null as { message: string } | null,
  // The family data the stub StepFamilyInfo submits — tests override the
  // address to pin the conditional postcode/city spread.
  familyData: {} as Record<string, unknown>,
}));

const FULL_ADDRESS = {
  fullAddress: '10 Rue Cler, 75007 Paris',
  street: '10 Rue Cler',
  city: 'Paris',
  postcode: '75007',
  lat: 48.857,
  lng: 2.305,
};

function defaultFamilyData() {
  return {
    familyName: 'Durand',
    lastName: '',
    firstName: 'Claire',
    address: { ...FULL_ADDRESS },
    pets: 'Cat',
    note: 'Ring twice',
  };
}

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    // Model a backend rejection carrying the details.reason the SDK surfaces.
    if (name === 'enrollFamily' && h.errorReason) {
      return Promise.reject({ details: { reason: h.errorReason } });
    }
    // Model a reason-less rejection (e.g. the createUser race backstop):
    // the SDK surfaces an Error whose message is the HttpsError message.
    if (name === 'enrollFamily' && h.rawError) {
      return Promise.reject(new Error(h.rawError.message));
    }
    return Promise.resolve({ data: { uid: 'u1', familyId: 'f1' } });
  },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => h.signIn(...args),
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = (() => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
    refreshUserDoc: h.refreshUserDoc,
  })) as unknown as {
    (): unknown;
    getState: () => unknown;
    subscribe: (fn: (s: unknown) => void) => () => void;
  };
  // Statics used by the post-signup auto-login wait and the navigate gate.
  // getState reads the mutable h.auth, so whether the store looks settled
  // depends on h.signIn having landed firebaseUser + the parent doc — the
  // guard-predicate gate (issue #264) genuinely passes on a successful
  // sign-in and fails on the failure paths. subscribe RECORDS listeners
  // (h.subscribers) so tests can model the snapshot landing late; unfired
  // listeners leave the wait to its timeout backstop.
  useAuthStore.getState = () => ({ loading: false, firebaseUser: h.auth.firebaseUser, userDoc: h.auth.userDoc });
  useAuthStore.subscribe = (fn: (s: unknown) => void) => {
    h.subscribers.push(fn);
    return () => {
      const i = h.subscribers.indexOf(fn);
      if (i >= 0) h.subscribers.splice(i, 1);
    };
  };
  return { useAuthStore, markNextSignInFresh: () => {} };
});
vi.mock('@ejm/shared-core', () => ({
  ADMIN_CONFIG_DEFS: {
    verificationCodeCooldownS: { default: 60, min: 60, max: 600, description: '' },
  },
  getParentProfile: (userDoc: { profiles?: { parent?: unknown } } | null) =>
    userDoc?.profiles?.parent ?? null,
  // Mirrors the real helper (issue #279, round-7 shape): EITHER membership
  // field counts. Drift guard:
  // packages/shared-core/.../hasFamilyMembership.test.ts pins the real one.
  hasFamilyMembership: (
    userDoc: { familyId?: string; profiles?: { parent?: { familyId?: string } } } | null,
  ) => !!(userDoc?.profiles?.parent?.familyId || userDoc?.familyId),
}));
vi.mock('@ejm/study-core', () => ({
  // Same precedence as the real adapter: tutor wins over parent.
  getStudyRole: (userDoc: { profiles?: { tutor?: unknown; parent?: unknown } } | null) =>
    userDoc?.profiles?.tutor ? 'tutor' : userDoc?.profiles?.parent ? 'parent' : undefined,
}));

// Lightweight stand-ins for the shared step components: each exposes a button
// that fires its callback so we can drive the orchestrator deterministically.
vi.mock('@ejm/shared-ui', () => ({
  // The app's adminConfigClient wrapper instantiates this at import time
  // (issue #250) -- stub returns the caller's fallback (code default).
  createAdminConfigReader: () => ({
    getClientConfigValue: (_k: string, fallback: number) => Promise.resolve(fallback),
    // The hook lives on the factory too (round-7 consolidation).
    useClientConfigValue: (_k: string, fallback: number) => fallback,
    __resetAdminConfigClientCacheForTests: () => {},
  }),
  // Mirrors the real helper: read details.reason off the rejected value.
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'profile-exists' || reason === 'role-exclusive' ? reason : null;
  },
  TopNav: ({ title, onBack }: { title: string; onBack?: () => void }) => (
    <div>
      {title}
      {onBack && <button onClick={onBack}>top-back</button>}
    </div>
  ),
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
  // Renders its error prop like the real component (CodeInput surfaces it),
  // so tests can pin that a family-step rejection doesn't leak back here.
  StepVerify: ({ onVerify, onResend, error }: { onVerify: (c: string) => void; onResend: () => void; error?: string | null }) => (
    <div>
      {error && <p>verify-error:{error}</p>}
      <button onClick={() => onVerify('123456')}>verify-submit</button>
      <button onClick={() => onResend()}>verify-resend</button>
    </div>
  ),
  StepPassword: (props: { onSubmit: (pw: string, c: string) => void; collectPassword?: boolean }) => (
    <button
      data-testid="step-password"
      data-collect={String(props.collectPassword)}
      onClick={() => props.onSubmit('Pw123456!', '2025-12-01')}
    >
      password-submit
    </button>
  ),
}));
vi.mock('@/components/ui/EnrollmentAppBar', () => ({
  EnrollmentAppBar: () => <div>enrollment-app-bar</div>,
}));
vi.mock('../StepParentEmail', () => ({
  StepParentEmail: ({ onChange, onSubmit }: { onChange: (e: string) => void; onSubmit: () => void }) => (
    <button
      onClick={() => {
        onChange('claire@example.com');
        onSubmit();
      }}
    >
      email-submit
    </button>
  ),
}));
vi.mock('../StepFamilyInfo', () => ({
  // Controlled stub mirroring the real component's API: `family-fill` pushes
  // the test's draft up through onChange (the orchestrator owns the draft),
  // `family-submit` fires the argless onNext. The rendered familyName pins
  // draft preservation across a back-navigation.
  StepFamilyInfo: ({ data, onChange, onNext, error }: {
    data: { familyName: string };
    onChange: (partial: unknown) => void;
    onNext: () => void;
    error?: string | null;
  }) => (
    <div>
      {error && <p>{error}</p>}
      <span>family-name:{data.familyName}</span>
      <button onClick={() => onChange(h.familyData)}>family-fill</button>
      <button onClick={() => onNext()}>family-submit</button>
    </div>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import i18n from '@/i18n';
import { ParentEnrollment } from '../ParentEnrollment';

function renderFlow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ParentEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.signIn.mockClear();
  h.subscribers.length = 0;
  h.errorReason = null;
  h.rawError = null;
  h.familyData = defaultFamilyData();
});

afterEach(() => {
  // Safety: a fake-timer test that fails mid-way must not leak fake timers
  // into the next test.
  vi.useRealTimers();
});

describe('ParentEnrollment orchestrator', () => {
  it('starts on the email step with the auth-phase chrome (TopNav + StepIndicator)', () => {
    renderFlow();
    expect(screen.getByText('email-submit')).toBeInTheDocument();
    expect(screen.getByText('step-0')).toBeInTheDocument();
    expect(screen.queryByText('enrollment-app-bar')).toBeNull();
  });

  it('drives through all steps and submits enrollFamily, then signs in and navigates to /family', async () => {
    renderFlow();

    fireEvent.click(screen.getByText('email-submit'));
    expect(await screen.findByText('verify-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyParentEmail');

    fireEvent.click(screen.getByText('verify-submit'));
    expect(await screen.findByText('password-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyCode');

    // Signed-out (default): password is collected.
    expect(screen.getByTestId('step-password')).toHaveAttribute('data-collect', 'true');

    // Step 2 -> 3 crosses into the post-auth phase: the step indicator goes
    // away, and a FRESH signup keeps TopNav with a back affordance (expired
    // codes are rescued from the verify step) — not the add-profile app bar.
    fireEvent.click(screen.getByText('password-submit'));
    expect(await screen.findByText('family-submit')).toBeInTheDocument();
    expect(screen.queryByText('enrollment-app-bar')).toBeNull();
    expect(screen.getByText('top-back')).toBeInTheDocument();
    expect(screen.queryByText(/step-\d/)).toBeNull();

    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      email: 'claire@example.com',
      verificationCode: '123456',
      password: 'Pw123456!',
      // The consent version StepPassword presented is the one persisted
      // (issue #178) — never sit's '1.0'.
      consentVersion: '2025-12-01',
      familyName: 'Durand',
      firstName: 'Claire',
      address: '10 Rue Cler, 75007 Paris',
      latLng: { lat: 48.857, lng: 2.305 },
      // Geocoder components ride along from the AddressResult (issue #167) —
      // coverage-area matching depends on them.
      postcode: '75007',
      city: 'Paris',
      pets: 'Cat',
      note: 'Ring twice',
      kids: [],
    });
    // Empty lastName means "same as family name" — the key must be ABSENT
    // (not sent as ''), the backend falls back to familyName.
    expect(payload).not.toHaveProperty('lastName');

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    // New-account path signs the parent in — the navigation must land in
    // the portal, not bounce to login.
    expect(h.signIn).toHaveBeenCalledWith(expect.anything(), 'claire@example.com', 'Pw123456!');
  });

  it('verifyParentEmail carries the study app hint (silent account-exists copy, issue #154)', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await vi.waitFor(() => {
      const call = h.calls.find((c) => c.name === 'verifyParentEmail');
      expect(call).toBeTruthy();
      // The stub StepParentEmail fires onChange+onSubmit in the same tick, so
      // the email state is still the initial '' in this render — the pin here
      // is the app hint, not the email value.
      expect(call!.payload).toMatchObject({ app: 'study' });
    });
  });

  it('the resend path ALSO carries the study app hint (issue #154 ledger)', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-resend'));

    await vi.waitFor(() => {
      const sends = h.calls.filter((c) => c.name === 'verifyParentEmail');
      expect(sends.length).toBe(2);
      for (const send of sends) {
        expect(send.payload).toMatchObject({ app: 'study' });
      }
    });
  });

  it('omits postcode/city from the payload when the address lacks them', async () => {
    h.familyData = {
      ...defaultFamilyData(),
      address: { ...FULL_ADDRESS, postcode: '', city: '' },
    };
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    fireEvent.click(await screen.findByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    // ABSENT, not empty strings — the schema takes optional strings and the
    // backend nulls what is missing.
    expect(enroll.payload).not.toHaveProperty('postcode');
    expect(enroll.payload).not.toHaveProperty('city');
  });

  it('back from the family step returns to verify with the draft preserved and NO stale error (expired-code rescue)', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));

    // Fill the draft and produce a family-step rejection first — the stale
    // message must NOT follow the user back under the code input.
    fireEvent.click(await screen.findByText('family-fill'));
    expect(screen.getByText('family-name:Durand')).toBeInTheDocument();
    h.errorReason = 'profile-exists';
    fireEvent.click(screen.getByText('family-submit'));
    expect(await screen.findByText(i18n.t('enrollment.alreadyInFamily'))).toBeInTheDocument();
    h.errorReason = null;

    fireEvent.click(screen.getByText('top-back'));

    // Lands directly on the verify step (where the resend lives) — not on
    // the password step — and the family-step error did not leak.
    expect(await screen.findByText('verify-submit')).toBeInTheDocument();
    expect(screen.queryByText(/verify-error:/)).toBeNull();
    expect(screen.queryByText(i18n.t('enrollment.alreadyInFamily'))).toBeNull();

    // Forward again: the draft survived the round trip because the
    // orchestrator owns it.
    fireEvent.click(screen.getByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    expect(await screen.findByText('family-name:Durand')).toBeInTheDocument();
  });

  it('authed WITH a parent profile: redirects to /family instead of enrolling', () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { profiles: { parent: { familyId: 'fam-1' } } }, loading: false };
    renderFlow();
    expect(h.navigate).toHaveBeenCalledWith('/family', { replace: true });
  });

  it('authed without a parent profile: jumps to consent-only StepPassword, payload omits credentials, refreshes doc', async () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { profiles: {} }, loading: false };
    // Model the real store: refreshUserDoc pulls the freshly-added parent
    // profile. The redirect effect must NOT hijack the success navigation
    // once this lands.
    h.refreshUserDoc = vi.fn().mockImplementation(() => {
      h.auth.userDoc = { profiles: { parent: { familyId: 'fam-1' } } };
      return Promise.resolve();
    });
    renderFlow();

    // Credential steps skipped: straight to the consent-only password step.
    const passwordStep = await screen.findByTestId('step-password');
    expect(passwordStep).toHaveAttribute('data-collect', 'false');
    expect(screen.queryByText('email-submit')).toBeNull();
    // No step indicator either — it would paint credential steps this path
    // can never reach.
    expect(screen.queryByText(/step-\d/)).toBeNull();

    fireEvent.click(passwordStep);
    // Add-profile family step keeps the app bar and gets NO back arrow —
    // this path never held a verification code to rescue.
    expect(await screen.findByText('family-fill')).toBeInTheDocument();
    expect(screen.getByText('enrollment-app-bar')).toBeInTheDocument();
    expect(screen.queryByText('top-back')).toBeNull();
    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    // Credential keys are ABSENT (not sent empty) — the backend takes the
    // add-profile branch on the existing account.
    for (const key of ['email', 'verificationCode', 'password']) {
      expect(enroll.payload).not.toHaveProperty(key);
    }
    // The consent-only step's acceptance still travels: the backend records
    // it in the audit trail (issue #178).
    expect(enroll.payload).toMatchObject({ consentVersion: '2025-12-01' });
    // Already signed in — no re-authentication.
    expect(h.signIn).not.toHaveBeenCalled();
    // refreshUserDoc must be awaited before the success navigation.
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    expect(h.refreshUserDoc).toHaveBeenCalled();
    // The now-present parent profile must not divert the navigation. Flush
    // the post-refresh render + effects first — without it the hijack
    // navigate would not have fired yet and the pin would pass vacuously
    // (found via the sit mirror of this test, PR #259 review).
    await act(async () => {});
    expect(h.navigate).not.toHaveBeenCalledWith('/family', { replace: true });
    // Exactly the success navigation — nothing before (no premature redirect)
    // and nothing after the flushed re-render (no extra navigation).
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  async function driveToEnrollFamily() {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    fireEvent.click(await screen.findByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));
    await vi.waitFor(() => expect(h.calls.some((c) => c.name === 'enrollFamily')).toBe(true));
  }

  it("enrollFamily 'profile-exists' rejection renders alreadyInFamily and NO login link", async () => {
    h.errorReason = 'profile-exists';
    await driveToEnrollFamily();

    const msg = i18n.t('enrollment.alreadyInFamily');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
  });

  it("enrollFamily 'role-exclusive' rejection renders the provider-account explanation", async () => {
    // Defense-in-depth: the signup role page withholds the parent option from
    // provider accounts (issue #116), but a direct /enroll/parent visit still
    // gets the explanation instead of a raw server error.
    h.errorReason = 'role-exclusive';
    await driveToEnrollFamily();

    const msg = i18n.t('signup.roleExclusiveParent');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
  });

  it('a reason-less enrollFamily rejection (race backstop) shows the plain message', async () => {
    // Issue #148: an existing account produces no special client branch. The
    // only remaining already-exists surface is the createUser race backstop,
    // which arrives reason-less and renders as a plain error string.
    h.rawError = { message: 'An account with this email already exists' };
    await driveToEnrollFamily();

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
    // A GENUINE enrollment failure keeps reading as one — never the
    // account-ready screen, and the post-enrollment sign-in never ran (a
    // future refactor that widens the inner try would silently reclassify
    // the rejection).
    expect(screen.queryByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeNull();
    expect(h.signIn).not.toHaveBeenCalled();
  });
});

describe('ParentEnrollment post-enrollment session gate (issue #264)', () => {
  async function reachFamilyStep() {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    fireEvent.click(await screen.findByText('family-fill'));
  }

  it('a sign-in failure after successful enrollment shows the account-ready login state, never a guarded bounce', async () => {
    // Enrollment fully succeeded (account/family doc/user doc written, code
    // consumed) — an auth hiccup must not read as an enrollment error. But
    // /family sits behind AuthGuard role="parent", so a signed-out navigate
    // would bounce to /login with no confirmation: the wizard confirms in
    // place instead (ports sit #262 / tutor PR #257).
    h.signIn.mockRejectedValueOnce(new Error('auth/network-request-failed'));
    await reachFamilyStep();
    fireEvent.click(screen.getByText('family-submit'));

    expect(await screen.findByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
    // The swallowed auth error must not surface as an enrollment failure.
    expect(screen.queryByText(/network-request-failed/)).toBeNull();
    // The CTA hands the parent to login.
    fireEvent.click(screen.getByText(i18n.t('enrollment.parent.readyLoginCta')));
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });

  it('a user-doc read blip after a SUCCESSFUL sign-in shows the login state after the backstop + recovery, not a bounce to /signup', async () => {
    // firebaseUser present but userDoc never settling: the OLD wait resolved
    // on firebaseUser alone and navigated — the guard then bounced the
    // enrolled parent to /signup. The new wait times out
    // (SESSION_SETTLE_TIMEOUT_MS), the recovery refresh misses twice, and
    // the gate fails: confirm-plus-login instead of a bounce.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // the doc read blips
    });
    await reachFamilyStep();

    // Fake timers from here so the 5s backstop and the recovery's 400ms
    // backoff are advanced, not slept. All in-between progress is microtasks
    // (mock promises), which advanceTimersByTimeAsync flushes.
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('family-submit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000); // SESSION_SETTLE_TIMEOUT_MS + PROFILE_RETRY_BACKOFF_MS + slack
    });
    vi.useRealTimers();

    expect(await screen.findByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
    // The recovery pass ran: refresh, backoff, refresh — before latching.
    expect(h.refreshUserDoc).toHaveBeenCalledTimes(2);

    // The CTA hands the parent to login. (Late-settle recovery is owned
    // entirely by the screen's subscription — pinned below — so the CTA
    // stays a plain navigate.)
    fireEvent.click(screen.getByText(i18n.t('enrollment.parent.readyLoginCta')));
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });

  it('the recovery refresh that lands the parent doc still navigates to /family — no ready screen', async () => {
    // The settle wait timed out but the SECOND recovery refresh (after the
    // backoff) pulls the doc: the gate passes and the parent lands in the
    // portal without ever seeing the fallback state.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // doc not settled yet
    });
    h.refreshUserDoc = vi.fn()
      .mockResolvedValueOnce(undefined) // first refresh: still a miss
      .mockImplementationOnce(() => {
        h.auth.userDoc = { profiles: { parent: { familyId: 'fam-1' } } };
        return Promise.resolve();
      });
    await reachFamilyStep();

    vi.useFakeTimers();
    fireEvent.click(screen.getByText('family-submit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    vi.useRealTimers();

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    expect(h.refreshUserDoc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeNull();
  });

  it('the account-ready screen auto-advances when the session settles late (no click needed)', async () => {
    // Once the backstop has fired, the screen keeps listening: a session
    // that settles moments later advances to the portal on its own.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // doc blips
    });
    await reachFamilyStep();

    vi.useFakeTimers();
    fireEvent.click(screen.getByText('family-submit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    vi.useRealTimers();

    expect(await screen.findByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeInTheDocument();
    // The screen subscribed for a late settle (the wait's own listener
    // already unsubscribed itself at timeout).
    await vi.waitFor(() => expect(h.subscribers.length).toBe(1));

    h.auth.userDoc = { profiles: { parent: { familyId: 'fam-1' } } };
    await act(async () => {
      h.subscribers[0]({ loading: false, firebaseUser: h.auth.firebaseUser, userDoc: h.auth.userDoc });
    });
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
  });

  it('resolves through the store SUBSCRIPTION when the doc settles after sign-in (production path, no backstop stall)', async () => {
    // Production ordering: signInWithEmailAndPassword resolves before the
    // user-doc snapshot lands, so the wait's immediate check fails and
    // resolution comes from the subscribed listener every time. A broken
    // subscription would ship as "every signup stalls 5s, then runs the
    // recovery" — this pin is the only one that exercises that path.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // doc NOT settled yet
    });
    await reachFamilyStep();
    fireEvent.click(screen.getByText('family-submit'));

    // The wait registered its listener (immediate check failed).
    await vi.waitFor(() => expect(h.subscribers.length).toBe(1));
    expect(h.navigate).not.toHaveBeenCalledWith('/family');

    // The snapshot lands: settle the store and notify the listener.
    h.auth.userDoc = { profiles: { parent: { familyId: 'fam-1' } } };
    await act(async () => {
      h.subscribers[0]({ loading: false, firebaseUser: h.auth.firebaseUser, userDoc: h.auth.userDoc });
    });

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    // The resolved wait unsubscribed itself (the unsub/clearTimeout handshake).
    expect(h.subscribers.length).toBe(0);
    // No fallback state, no recovery refresh — the wait settled in time.
    expect(screen.queryByText(i18n.t('enrollment.parent.readyLoginTitle'))).toBeNull();
    expect(h.refreshUserDoc).not.toHaveBeenCalled();
  });
});
