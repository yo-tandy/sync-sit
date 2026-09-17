import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { getSitRole } from '@ejm/sit-core';
import {
  StepParentEmail,
  StepVerify,
  StepPassword,
  StepFamilyInfo,
  enrollmentErrorReason,
  type FamilyFormData,
  AuthColumn,
} from '@ejm/shared-ui';
import { ADMIN_CONFIG_DEFS, CONSENT_VERSION, hasFamilyMembership } from '@ejm/shared-core';
import { useClientConfigValue } from '@/lib/adminConfigClient';
import { TopNav, StepIndicator } from '@/components/ui';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Family info (submitting).
// The shared parent wizard (issue #440, plan doc 2026-09-16): the same four
// shared steps as study's parent wizard, with sit's app hint, brand mark and
// notes copy. Consent lives on StepPassword (the student / study convention),
// so the fresh signup and the consent-only add-profile entry both consent
// exactly once — sit's family step no longer carries a consent checkbox.
const TOTAL_STEPS = 4;
const AUTH_STEPS = 3;

interface EnrollFamilyInput {
  // Credential keys are OMITTED entirely (not sent empty) on the authed
  // add-profile path so the backend takes the add-profile branch.
  email?: string;
  verificationCode?: string;
  password?: string;
  familyName: string;
  lastName?: string;
  firstName: string;
  address: string;
  latLng: { lat: number; lng: number };
  postcode?: string;
  city?: string;
  pets?: string;
  note?: string;
  kids: { firstName: string; age: number; languages: string[] }[];
  // The consent-document version StepPassword presented (issue #178 /
  // #415 decision 2). Sit used to send nothing and rely on the server
  // default; it now sends what was shown, like every other wizard.
  consentVersion?: string;
  // UI language the wizard ran in (issue #440 audit, #511). New-account
  // path only: an add-profile caller's user doc already has a language.
  language?: 'en' | 'fr';
}

// How long the post-signup wait gives the auth store to settle into a state
// that passes AuthGuard's predicate before falling back to the in-wizard
// account-ready login state (issue #262). The stranding tests derive their
// wait budgets from this value.
const SESSION_SETTLE_TIMEOUT_MS = 5000;

// AuthGuard role="parent"'s own predicate, in one place: the post-signup
// wait, the settled-store gate, the CTA re-check, and the late-settle
// auto-advance all evaluate exactly this (issue #262).
const passesParentGuard = (s: ReturnType<typeof useAuthStore.getState>) =>
  !s.loading && !!s.firebaseUser && getSitRole(s.userDoc) === 'parent';

const INITIAL_FAMILY: FamilyFormData = {
  familyName: '',
  lastName: '',
  firstName: '',
  address: null,
  pets: '',
  note: '',
};

export function ParentEnrollment() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();

  // Add-profile mode: an already-authenticated user with no family membership
  // yet (issue #279: membership, not profile presence — an orphan parent
  // profile may enroll a NEW family through this path). Credentials are
  // already established, so the flow starts at the consent-only password
  // step.
  const isAddProfile = !!firebaseUser && !hasFamilyMembership(userDoc);

  // Admin-configurable resend window (issue #250) -- must match the
  // server's, whose repeat path answers with a decoy success.
  const resendCooldownS = useClientConfigValue(
    'verificationCodeCooldownS',
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS,
  );

  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [consentVersion, setConsentVersion] = useState('');
  // The family draft lives HERE (controlled StepFamilyInfo): the expired-code
  // rescue walks back to the verify step and the draft must survive the
  // round trip.
  const [family, setFamily] = useState<FamilyFormData>(INITIAL_FAMILY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enrollment succeeded but the fresh session cannot pass AuthGuard
  // role="parent" (sign-in failed, or the doc read never settled): confirm
  // the account in place and hand off to login (issue #262).
  const [signedOutSuccess, setSignedOutSuccess] = useState(false);

  // For a signed-in user, resolve where the flow starts. Guard on step === 0 so
  // this only fires before the flow begins: after an add-profile success,
  // refreshUserDoc() adds profiles.parent and this effect must NOT hijack the
  // success navigation to /family.
  useEffect(() => {
    if (step !== 0 || authLoading || !firebaseUser) return;
    if (hasFamilyMembership(userDoc)) {
      navigate('/family', { replace: true });
    } else {
      // Skip the credential steps and land on the consent-only password
      // step — every path consents exactly once, on StepPassword.
      setStep(2);
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  // The account-ready screen treats "merely slow" as the expected case: if
  // the session settles into a guard-passing state while it is shown, advance
  // to the portal without requiring the click (issue #262 round 3). This
  // effect owns late-settle recovery ENTIRELY — the immediate check covers
  // the flip-to-mounted gap and the subscription covers everything after, so
  // the login CTA stays a plain navigate('/login').
  useEffect(() => {
    if (!signedOutSuccess) return;
    if (passesParentGuard(useAuthStore.getState())) {
      navigate('/family');
      return;
    }
    return useAuthStore.subscribe((s) => {
      if (passesParentGuard(s)) navigate('/family');
    });
  }, [signedOutSuccess, navigate]);

  // The first step this user can see — back-navigation never crosses below it
  // (an add-profile user has no credential steps to go back to).
  const firstStep = isAddProfile ? 2 : 0;

  const updateFamily = (partial: Partial<FamilyFormData>) => {
    setFamily((prev) => ({ ...prev, ...partial }));
    setError(null);
  };

  // Maps a callable error to the right UI state; returns true if it produced a
  // specialised message. There is NO account-exists branch: signup with an
  // existing email is silent (issue #148) — the backend responds like a fresh
  // signup and emails the owner.
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyInFamily'));
      return true;
    }
    if (reason === 'role-exclusive') {
      // Defense-in-depth for a direct /enroll/parent visit by a babysitter
      // account — the unified landing page never offers it (issue #116).
      setError(t('signup.roleExclusiveParent'));
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      // `app` only selects the copy of the silent account-exists email — it
      // MUST say 'sit' on every call, resends included (issue #148/#154).
      await verifyEmail({ email, app: 'sit' });
      setStep(1);
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to send verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCodeVerified = (code: string) => {
    setVerificationCode(code);
    setError(null);
    setStep(2);
  };

  const handlePasswordNext = (pw: string, consent: string) => {
    setPassword(pw);
    // Record the version StepPassword actually presented — it goes into the
    // enrollFamily payload so the persisted consent matches the shown terms.
    setConsentVersion(consent);
    setError(null);
    setStep(3);
  };

  const handleFamilyInfoNext = async () => {
    const data = family;
    if (!data.address) return;
    setLoading(true);
    setError(null);
    try {
      const enrollFamily = httpsCallable<EnrollFamilyInput, { uid: string; familyId: string }>(
        functions,
        'enrollFamily',
      );
      const familyPayload: EnrollFamilyInput = {
        familyName: data.familyName,
        ...(data.lastName ? { lastName: data.lastName } : {}),
        firstName: data.firstName,
        address: data.address.fullAddress,
        latLng: { lat: data.address.lat, lng: data.address.lng },
        // Geocoder components ride along (issue #167) so the family doc can
        // resolve a tutor coverage-area label without a re-pick in search.
        // Omitted (not null) when absent — the enrollment schema takes
        // optional strings.
        ...(data.address.postcode ? { postcode: data.address.postcode } : {}),
        ...(data.address.city ? { city: data.address.city } : {}),
        ...(data.pets ? { pets: data.pets } : {}),
        ...(data.note ? { note: data.note } : {}),
        // Children are managed after enrollment at /family/settings.
        kids: [],
        // Both branches send it: the new-account path persists it on the
        // user doc, the add-profile path records it in the audit trail.
        ...(consentVersion ? { consentVersion } : {}),
      };

      if (isAddProfile) {
        // Authed add-profile: send only the family payload — omitting the
        // credential keys (and language: the account has its own) makes the
        // backend merge into the existing account.
        await enrollFamily(familyPayload);
        await refreshUserDoc();
        navigate('/family');
        return;
      }

      await enrollFamily({
        email,
        verificationCode,
        password,
        ...familyPayload,
        // The UI language the parent enrolled in, persisted on the user doc
        // so server email copy follows it (issue #440 audit / #511).
        language: i18n.language?.startsWith('fr') ? 'fr' : 'en',
      });

      // The account was created server-side (adminAuth) — sign the new
      // parent in NOW so completion lands in their portal. BEST-EFFORT for
      // the ENROLLMENT: it has already fully succeeded (account, family doc,
      // user doc written; the verification code consumed), so a sign-in or
      // doc-read hiccup must never read as an enrollment failure. But
      // /family sits behind AuthGuard role="parent", so navigating requires
      // the settled session to pass the guard's own predicate — anything
      // less renders the in-wizard "account ready — log in" state instead
      // of a silent guard bounce (issue #262, mirroring PR #257 round 1 on
      // the tutor side).
      try {
        // Fresh, deliberate sign-in: capture the session epoch anew (issue #181).
        markNextSignInFresh();
        await signInWithEmailAndPassword(auth, email, password);
        await new Promise<void>((resolve) => {
          // Resolve when the guard's predicate would pass (signed in AND the
          // parent role resolved from the doc); the timeout backstops a store
          // that never settles or a doc read that keeps blipping.
          const timer = setTimeout(() => { unsub(); resolve(); }, SESSION_SETTLE_TIMEOUT_MS);
          const check = (state: ReturnType<typeof useAuthStore.getState>) => {
            if (passesParentGuard(state)) {
              clearTimeout(timer);
              unsub();
              resolve();
            }
          };
          const unsub = useAuthStore.subscribe(check);
          check(useAuthStore.getState());
        });
      } catch (err) {
        // Swallowed by design — see above. Logged so a stranded enrollee
        // leaves a trace: this branch is invisible from the UI.
        console.warn('post-enrollment sign-in did not settle; showing account-ready state', err);
      }

      if (passesParentGuard(useAuthStore.getState())) {
        navigate('/family');
      } else {
        setSignedOutSuccess(true);
      }
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to create account');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > firstStep) setStep(step - 1);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepParentEmail
            email={email}
            onChange={setEmail}
            onSubmit={handleSendCode}
            loading={loading}
            error={error}
            logoSrc="/logo.png"
            logoAlt="Sync/Sit"
          />
        );
      case 1:
        return (
          <StepVerify
            resendCooldownS={resendCooldownS}
            ejemEmail={email}
            onVerify={async (code) => {
              const verifyFn = httpsCallable(functions, 'verifyCode');
              await verifyFn({ email, code });
              handleCodeVerified(code);
            }}
            onResend={async () => {
              const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
              // Resends carry the same app hint (issue #154).
              await verifyEmail({ email, app: 'sit' });
            }}
            error={error}
          />
        );
      case 2:
        return (
          <StepPassword
            collectPassword={!isAddProfile}
            onSubmit={async (pw, consent) => {
              handlePasswordNext(pw, consent);
            }}
            consentVersion={CONSENT_VERSION}
            loading={loading}
            error={error}
          />
        );
      case 3:
        return (
          <StepFamilyInfo
            data={family}
            onChange={updateFamily}
            onNext={handleFamilyInfoNext}
            loading={loading}
            error={error}
            noteLabel={t('enrollment.notesForBabysitters')}
          />
        );
      default:
        return null;
    }
  };

  // Wait for auth resolution before mounting the wizard: this keeps the
  // add-profile decision (jump to step 2 vs. redirect to /family) and the
  // collectPassword choice from being made against a not-yet-known auth state.
  if (authLoading) return null;

  if (signedOutSuccess) {
    // Enrollment succeeded but the session cannot pass AuthGuard: confirm
    // the account exists and point at login — never a silent bounce.
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-3 text-2xl font-bold text-gray-950">
          {t('enrollment.readyLoginTitle')}
        </h1>
        <p className="mb-8 max-w-[300px] text-sm leading-relaxed text-gray-500">
          {t('enrollment.readyLoginDesc')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-600/90"
        >
          {t('enrollment.readyLoginCta')}
        </button>
      </div>
    );
  }

  const isPostAuthStep = step >= AUTH_STEPS;

  return (
    <AuthColumn>
      {isPostAuthStep && isAddProfile ? (
        // Add-profile users never held a code, so they keep the plain
        // enrollment bar on the family step.
        <EnrollmentAppBar />
      ) : (
        <>
          <TopNav
            title={t('enrollment.parentTitle')}
            backTo={step === firstStep ? '/enroll' : undefined}
            onBack={
              step > firstStep
                ? isPostAuthStep
                  ? () => {
                      // Fresh signups keep a back affordance on the family
                      // step: the verification code has a 10-minute TTL that
                      // can expire while the form is filled, and the only
                      // rescue is resending from the verify step. Straight to
                      // verify — the draft survives, it lives here. The error
                      // is cleared: a family-step rejection must not leak
                      // under the code input.
                      setError(null);
                      setStep(1);
                    }
                  : handleBack
                : undefined
            }
          />
          {/* Add-profile enters at the consent step and can never reach the
              credential steps below it — a 4-dot indicator would paint
              unreachable steps, so it is hidden on that path. */}
          {!isAddProfile && <StepIndicator totalSteps={TOTAL_STEPS} currentStep={step} />}
        </>
      )}
      {renderStep()}
    </AuthColumn>
  );
}
