import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { getParentProfile, getSitRole } from '@ejm/sit-core';
import { enrollmentErrorReason } from '@ejm/shared-ui';
import { TopNav, StepIndicator } from '@/components/ui';
import { StepParentEmail } from './parent/StepParentEmail';
import { StepParentVerify } from './parent/StepParentVerify';
import { StepParentPassword } from './parent/StepParentPassword';
import { StepFamilyInfo } from './parent/StepFamilyInfo';

export interface KidFormData {
  firstName: string;
  age: number;
  languages: string[];
}

export interface ParentFormData {
  email: string;
  verificationCode: string;
  password: string;
  familyName: string;
  lastName: string;
  firstName: string;
  address: {
    fullAddress: string;
    street: string;
    city: string;
    postcode: string;
    lat: number;
    lng: number;
  } | null;
  pets: string;
  note: string;
  kids: KidFormData[];
  searchDefaults: {
    minBabysitterAge?: number;
    preferredGender?: string;
    requireReferences?: boolean;
    maxRate?: number;
  };
  consentAccepted: boolean;
  consentChildrenAccepted: boolean;
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

const INITIAL_DATA: ParentFormData = {
  email: '',
  verificationCode: '',
  password: '',
  familyName: '',
  lastName: '',
  firstName: '',
  address: null,
  pets: '',
  note: '',
  kids: [{ firstName: '', age: 0, languages: [] }],
  searchDefaults: {},
  consentAccepted: false,
  consentChildrenAccepted: false,
};

export function ParentEnrollment() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<ParentFormData>(INITIAL_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enrollment succeeded but the fresh session cannot pass AuthGuard
  // role="parent" (sign-in failed, or the doc read never settled): confirm
  // the account in place and hand off to login (issue #262).
  const [signedOutSuccess, setSignedOutSuccess] = useState(false);
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();

  // Add-profile mode: an already-authenticated user with no parent profile yet.
  // Steps 0-2 are all credentials (email/verify/password), so add-profile jumps
  // straight to FamilyInfo (step 3) via the mount effect below and never sends
  // credential keys to the callable.
  const isAddProfile = !!firebaseUser && !getParentProfile(userDoc);

  // For a signed-in user, resolve where the flow starts. Guard on step === 0 so
  // this only fires before the flow begins: after an add-profile success,
  // refreshUserDoc() adds profiles.parent and this effect must NOT hijack the
  // success navigation to /family.
  useEffect(() => {
    if (step !== 0 || authLoading || !firebaseUser) return;
    if (getParentProfile(userDoc)) {
      // Already a parent — nothing to add here.
      navigate('/family', { replace: true });
    } else {
      // Skip the credential steps and go straight to family info.
      setStep(3);
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  // The account-ready screen treats "merely slow" as the expected case: if
  // the session settles into a guard-passing state while it is shown, advance
  // to the portal without requiring the click (issue #262 round 3).
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

  const updateData = (partial: Partial<ParentFormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
    setError(null);
  };

  // Maps a callable error to the right UI state; returns true if it produced a
  // specialised message (already-in-family notice). There is NO account-exists
  // branch: signup with an existing email is silent (issue #148) — the backend
  // responds like a fresh signup and emails the owner.
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyInFamily'));
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      // `app` only selects the copy of the silent account-exists email.
      await verifyEmail({ email: formData.email, app: 'sit' });
      setStep(1);
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to send verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndContinue = () => {
    setStep(2);
  };

  const handlePasswordContinue = () => {
    setStep(3);
  };

  const handleFamilyInfoComplete = () => {
    handleComplete();
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      const enrollFamily = httpsCallable(functions, 'enrollFamily');
      const basePayload = {
        ...formData,
        kids: [],
        address: formData.address?.fullAddress || '',
        latLng: formData.address
          ? { lat: formData.address.lat, lng: formData.address.lng }
          : { lat: 48.8566, lng: 2.3522 },
        // Geocoder components ride along (issue #167) so the family doc can
        // resolve a tutor coverage-area label without a re-pick in search.
        // Omitted (not null) when absent — the enrollment schema takes
        // optional strings.
        ...(formData.address?.postcode ? { postcode: formData.address.postcode } : {}),
        ...(formData.address?.city ? { city: formData.address.city } : {}),
      };

      if (isAddProfile) {
        // Authed add-profile: send only the family payload. Omit the credential
        // keys (email/verificationCode/password) so the backend takes the
        // add-profile branch on the existing account, then refresh and navigate
        // without a new sign-in.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-omit of credential keys
        const { email, verificationCode, password, ...familyPayload } = basePayload;
        await enrollFamily(familyPayload);
        await refreshUserDoc();
        navigate('/family');
        return;
      }

      await enrollFamily(basePayload);

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
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
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
      } catch {
        // Swallowed by design — see above.
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

  const steps = [
    <StepParentEmail
      key="email"
      data={formData}
      onChange={updateData}
      onNext={handleSendCode}
      loading={loading}
      error={error}
    />,
    <StepParentVerify
      key="verify"
      data={formData}
      onChange={updateData}
      onNext={handleVerifyAndContinue}
      onResend={handleSendCode}
      loading={loading}
      error={error}
    />,
    <StepParentPassword
      key="password"
      data={formData}
      onChange={updateData}
      onNext={handlePasswordContinue}
      error={error}
    />,
    <StepFamilyInfo
      key="family"
      data={formData}
      onChange={updateData}
      onNext={handleFamilyInfoComplete}
      loading={loading}
      error={error}
    />,
  ];

  // Wait for auth resolution before mounting the wizard: this keeps the
  // add-profile decision (jump to step 3 vs. redirect to /family) from being
  // made against a not-yet-known auth state.
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
          onClick={() => {
            // A merely-slow session may have settled after the backstop
            // fired: re-check the guard's predicate at click time and route
            // straight to the portal instead of a needless re-login.
            if (passesParentGuard(useAuthStore.getState())) {
              navigate('/family');
            } else {
              navigate('/login');
            }
          }}
          className="flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-600/90"
        >
          {t('enrollment.readyLoginCta')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <TopNav
        title="Sync/Sit - Parent Sign Up"
        backTo={step === 0 ? '/' : undefined}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
      />
      <StepIndicator totalSteps={4} currentStep={step} />
      {steps[step]}
    </div>
  );
}
