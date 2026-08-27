import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, fireEvent, render, cleanup } from '@testing-library/react';

// Issue #148: the verify call must carry the sit app hint — it selects the
// copy of the silent account-exists email. A dropped hint fails silently
// (normalizeAccountExistsApp collapses anything unrecognized to 'sit'), so
// this pin is the only guard. Mirrors the babysitter/tutor wizard pins.
//
// Issue #176: the enrollFamily payload pins mirror study-web's — the geocoder
// components (postcode/city) must ride along on an autocomplete pick so the
// family doc can area-match in tutor search, and must be ABSENT (conditional
// spread, not null/'') when the address carries none.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
  // Controllable authStore state — default is signed out (fresh signup);
  // add-profile tests set a firebaseUser. Mirrors the study-web mock shape.
  auth: { firebaseUser: null as unknown, userDoc: null as unknown, loading: false },
  refreshUserDoc: () => Promise.resolve(),
  // A successful sign-in settles the store with the signed-in user AND the
  // freshly-written parent doc (models the real store); the navigate gate
  // reads them via getState. Failure paths override per-test: a rejection
  // settles nothing, a doc blip settles only firebaseUser — so the gate
  // fails and the account-ready login state renders (issue #262).
  signIn: vi.fn(() => {
    h.auth.firebaseUser = { uid: 'new' };
    h.auth.userDoc = { profiles: { parent: {} } };
    return Promise.resolve();
  }),
  // Listeners registered through the mocked store subscription — tests fire
  // them to model the auth snapshot landing after sign-in.
  subscribers: [] as Array<(s: unknown) => void>,
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

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return Promise.resolve({ data: { success: true } });
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
  // Mirrors the study-web mock: the hook reads the mutable h.auth (so tests
  // drive signed-out vs add-profile), while the getState/subscribe statics
  // model the post-sign-in store. Whether it reads as settled depends on
  // h.signIn having landed firebaseUser + the parent doc — so the
  // guard-predicate gate (issue #262) genuinely passes on a successful
  // sign-in and fails on the failure paths. subscribe RECORDS listeners
  // (h.subscribers) so tests can model the snapshot landing late; unfired
  // listeners leave the wait to its timeout backstop.
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
  useAuthStore.getState = () => ({
    loading: false,
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
  });
  useAuthStore.subscribe = (fn: (s: unknown) => void) => {
    h.subscribers.push(fn);
    return () => {
      const i = h.subscribers.indexOf(fn);
      if (i >= 0) h.subscribers.splice(i, 1);
    };
  };
  return { useAuthStore, markNextSignInFresh: () => {} };
});
vi.mock('@ejm/sit-core', () => ({
  getParentProfile: (userDoc: { profiles?: { parent?: unknown } } | null) =>
    userDoc?.profiles?.parent ?? null,
  // Same precedence as the real adapter: babysitter wins over parent.
  getSitRole: (userDoc: { profiles?: { babysitter?: unknown; parent?: unknown } } | null) =>
    userDoc?.profiles?.babysitter ? 'babysitter' : userDoc?.profiles?.parent ? 'parent' : undefined,
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
  StepParentVerify: ({ onNext }: { onNext: () => void }) => (
    <div>
      parent-verify-step
      <button onClick={onNext}>verify-submit</button>
    </div>
  ),
}));
vi.mock('../parent/StepParentPassword', () => ({
  StepParentPassword: ({ onNext }: { onNext: () => void }) => (
    <div>
      parent-password-step
      <button onClick={onNext}>password-submit</button>
    </div>
  ),
}));
vi.mock('../parent/StepFamilyInfo', () => ({
  // Controlled stub mirroring the real component's API: `family-fill` pushes
  // h.familyData through onChange, `family-submit` completes the wizard.
  StepFamilyInfo: ({ onChange, onNext }: {
    onChange: (partial: Record<string, unknown>) => void;
    onNext: () => void;
  }) => (
    <div>
      family-info-step
      <button onClick={() => onChange(h.familyData)}>family-fill</button>
      <button onClick={onNext}>family-submit</button>
    </div>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { ParentEnrollment } from '../ParentEnrollment';

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
  h.refreshUserDoc = vi.fn(() => Promise.resolve());
  h.signIn.mockClear();
  h.subscribers.length = 0;
  h.familyData = {
    familyName: 'Durand',
    firstName: 'Claire',
    address: { ...FULL_ADDRESS },
    pets: 'Cat',
    note: 'Ring twice',
  };
});

afterEach(() => {
  // Safety: a fake-timer test that fails mid-way must not leak fake timers
  // into the next test.
  vi.useRealTimers();
});

function renderFlow() {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ParentEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// Click through the credential steps (all stubs) to reach StepFamilyInfo.
async function reachFamilyStep() {
  fireEvent.click(screen.getByText('parent-email-submit'));
  fireEvent.click(await screen.findByText('verify-submit'));
  fireEvent.click(await screen.findByText('password-submit'));
  await screen.findByText('family-submit');
}

describe('ParentEnrollment verify payload (issue #148)', () => {
  it('verifyParentEmail is called with the sit app hint', async () => {
    renderFlow();

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

describe('ParentEnrollment enrollFamily payload (issue #176)', () => {
  it('an autocomplete pick sends postcode and city alongside address/latLng', async () => {
    renderFlow();
    await reachFamilyStep();

    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    expect(enroll.payload).toMatchObject({
      familyName: 'Durand',
      firstName: 'Claire',
      address: '10 Rue Cler, 75007 Paris',
      latLng: { lat: 48.857, lng: 2.305 },
      // Geocoder components ride along from the AddressResult (issue #167) —
      // coverage-area matching in tutor search depends on them.
      postcode: '75007',
      city: 'Paris',
      pets: 'Cat',
      note: 'Ring twice',
    });
    // The fresh-signup path completes: sign-in resolves, the auth-store wait
    // settles (getState is mocked resolved), and the wizard lands in the
    // portal.
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
  });

  it('an address without geocoder components OMITS postcode/city (no empty-string keys)', async () => {
    h.familyData = {
      ...h.familyData,
      // A legacy/hand-typed shape: the AddressResult fields exist but the
      // geocoder produced no components — empty strings, not undefined.
      address: { ...FULL_ADDRESS, postcode: '', city: '' },
    };
    renderFlow();
    await reachFamilyStep();

    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    // The keys must be ABSENT (conditional spread), never '' or null: the
    // enrollment schema takes optional strings (absent-or-bounded), and the
    // backend owns the missing→null normalization. Mirrors the study-web pin
    // so both apps hold the same wire contract.
    expect(enroll.payload).not.toHaveProperty('postcode');
    expect(enroll.payload).not.toHaveProperty('city');
    expect(enroll.payload).toMatchObject({ address: '10 Rue Cler, 75007 Paris' });
  });

  it('add-profile: payload keeps postcode/city and OMITS the credential keys', async () => {
    // Authed user without a parent profile: the wizard jumps straight to the
    // family step and the rest-omit strips email/verificationCode/password —
    // the postcode/city spread ships through this second call site too.
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { profiles: {} }, loading: false };
    // Model the real store: refreshUserDoc pulls the freshly-added parent
    // profile. The mount effect's step !== 0 guard must NOT hijack the
    // success navigation into a replace-redirect once this lands.
    h.refreshUserDoc = vi.fn().mockImplementation(() => {
      h.auth.userDoc = { profiles: { parent: {} } };
      return Promise.resolve();
    });
    renderFlow();

    fireEvent.click(await screen.findByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollFamily');
      expect(c).toBeTruthy();
      return c!;
    });
    expect(enroll.payload).toMatchObject({
      address: '10 Rue Cler, 75007 Paris',
      postcode: '75007',
      city: 'Paris',
    });
    expect(enroll.payload).not.toHaveProperty('email');
    expect(enroll.payload).not.toHaveProperty('verificationCode');
    expect(enroll.payload).not.toHaveProperty('password');

    // Add-profile refreshes the doc in place and lands in the portal without
    // a new sign-in — and the mount effect must not hijack the success
    // navigation into a replace-redirect after the refresh lands the profile.
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    expect(h.refreshUserDoc).toHaveBeenCalled();
    // Flush the post-refresh render + effects before the negative assertion —
    // without it the hijack navigate would not have fired yet and the pin
    // would pass vacuously (mutation-tested: deleting the step !== 0 guard
    // goes red only with this flush).
    await act(async () => {});
    expect(h.navigate).not.toHaveBeenCalledWith('/family', { replace: true });
    // Exactly the success navigation — nothing before (no premature redirect)
    // and nothing after the flushed re-render (no extra navigation).
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });
});

describe('ParentEnrollment post-enrollment session gate (issue #262)', () => {
  it('a sign-in failure after successful enrollment shows the account-ready login state, never a guarded bounce', async () => {
    // Enrollment fully succeeded (account/family doc/user doc written, code
    // consumed) — an auth hiccup must not read as an enrollment error. But
    // /family sits behind AuthGuard role="parent", so a signed-out navigate
    // would bounce to /login with no confirmation: the wizard confirms in
    // place instead (mirrors PR #257 round 1 on the tutor side).
    h.signIn.mockRejectedValueOnce(new Error('auth/network-request-failed'));
    renderFlow();
    await reachFamilyStep();

    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    expect(await screen.findByText('Your family account is ready')).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');
    // The swallowed auth error must not surface as an enrollment failure.
    expect(screen.queryByText(/network-request-failed/)).toBeNull();
    // The CTA hands the parent to login.
    fireEvent.click(screen.getByText('Log in'));
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });

  it('a user-doc read blip after a SUCCESSFUL sign-in also shows the login state, and the CTA recovers a late session', async () => {
    // firebaseUser present but userDoc never settling: the OLD wait hung the
    // wizard on its spinner forever — the second failure mode of issue #262.
    // The new wait times out (SESSION_SETTLE_TIMEOUT_MS) and the gate fails,
    // so the parent gets the confirm-plus-login state instead of a hang.
    // Signed in, but the doc read blips:
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve();
    });
    renderFlow();
    await reachFamilyStep();
    fireEvent.click(screen.getByText('family-fill'));

    // Fake timers from here so the 5s backstop is advanced, not slept. All
    // in-between progress is microtasks (mock promises), which act() flushes.
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('family-submit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001); // SESSION_SETTLE_TIMEOUT_MS + 1
    });
    vi.useRealTimers();

    expect(await screen.findByText('Your family account is ready')).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/family');

    // The session was merely slow: the doc lands after the backstop fired.
    // The CTA re-checks the predicate at click time and routes straight to
    // the portal — no needless re-login.
    h.auth.userDoc = { profiles: { parent: {} } };
    fireEvent.click(screen.getByText('Log in'));
    expect(h.navigate).toHaveBeenCalledWith('/family');
    expect(h.navigate).not.toHaveBeenCalledWith('/login');
  });

  it('the account-ready screen auto-advances when the session settles late (no click needed)', async () => {
    // Once the backstop has fired, the screen keeps listening: a session
    // that settles moments later advances to the portal on its own.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // doc blips
    });
    renderFlow();
    await reachFamilyStep();
    fireEvent.click(screen.getByText('family-fill'));

    vi.useFakeTimers();
    fireEvent.click(screen.getByText('family-submit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001); // SESSION_SETTLE_TIMEOUT_MS + 1
    });
    vi.useRealTimers();

    expect(await screen.findByText('Your family account is ready')).toBeInTheDocument();
    // The screen subscribed for a late settle (the wait's own listener
    // already unsubscribed itself at timeout).
    await vi.waitFor(() => expect(h.subscribers.length).toBe(1));

    h.auth.userDoc = { profiles: { parent: {} } };
    await act(async () => {
      h.subscribers[0]({ loading: false, firebaseUser: h.auth.firebaseUser, userDoc: h.auth.userDoc });
    });
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
  });

  it('resolves through the store SUBSCRIPTION when the doc settles after sign-in (production path, no backstop stall)', async () => {
    // Production ordering: signInWithEmailAndPassword resolves before the
    // user-doc snapshot lands, so the wait's immediate check fails and
    // resolution comes from the subscribed listener every time. A broken
    // subscription would ship as "every signup stalls 5s, then shows the
    // login state" — this pin is the only one that exercises that path.
    h.signIn.mockImplementationOnce(() => {
      h.auth.firebaseUser = { uid: 'new' };
      return Promise.resolve(); // doc NOT settled yet
    });
    renderFlow();
    await reachFamilyStep();
    fireEvent.click(screen.getByText('family-fill'));
    fireEvent.click(screen.getByText('family-submit'));

    // The wait registered its listener (immediate check failed).
    await vi.waitFor(() => expect(h.subscribers.length).toBe(1));
    expect(h.navigate).not.toHaveBeenCalledWith('/family');

    // The snapshot lands: settle the store and notify the listener.
    h.auth.userDoc = { profiles: { parent: {} } };
    await act(async () => {
      h.subscribers[0]({ loading: false, firebaseUser: h.auth.firebaseUser, userDoc: h.auth.userDoc });
    });

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/family'));
    // The resolved wait unsubscribed itself (the unsub/clearTimeout handshake).
    expect(h.subscribers.length).toBe(0);
  });
});
