import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { TopNav, StepIndicator, StepVerify, StepPassword, enrollmentErrorReason } from '@ejm/shared-ui';
import { getParentProfile } from '@ejm/shared-core';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepParentEmail } from './StepParentEmail';
import { StepFamilyInfo } from './StepFamilyInfo';
import type { FamilyFormData } from './StepFamilyInfo';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Family info (submitting).
// Sync-sit's ParentEnrollment is the FLOW reference (same backend callables:
// verifyParentEmail + enrollFamily); the tutor wizard is the STRUCTURE
// reference (shared credential steps, app-bar switch after them, best-effort
// post-enroll sign-in). The visible step indicator only covers the 3
// credential steps; the family-info step renders under the enrollment app bar.
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
  // Consent-document version the consent step presented (issue #178) — study
  // sends its own '2025-12-01' so the record matches the terms actually shown.
  consentVersion?: string;
}

const INITIAL_FAMILY: FamilyFormData = {
  familyName: '',
  lastName: '',
  firstName: '',
  address: null,
  pets: '',
  note: '',
};

export function ParentEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();

  // Add-profile mode: an already-authenticated user with no parent profile
  // yet (e.g. a signed-in study user adding the family role). Credentials are
  // already established, so the flow starts at the consent-only password step.
  const isAddProfile = !!firebaseUser && !getParentProfile(userDoc);

  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [consentVersion, setConsentVersion] = useState('');
  // The family draft lives HERE (sit's controlled pattern), not in the step:
  // the expired-code rescue walks back to the verify step and the draft must
  // survive the round trip.
  const [family, setFamily] = useState<FamilyFormData>(INITIAL_FAMILY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFamily = (partial: Partial<FamilyFormData>) => {
    setFamily((prev) => ({ ...prev, ...partial }));
    setError(null);
  };

  // For a signed-in user, resolve where the flow starts. Guard on step === 0
  // so this only fires before the flow begins: after an add-profile success,
  // refreshUserDoc() adds profiles.parent and this effect must NOT hijack the
  // success navigation to /family.
  useEffect(() => {
    if (step !== 0 || authLoading || !firebaseUser) return;
    if (getParentProfile(userDoc)) {
      // Already a parent — nothing to add here (covers sit parents too: their
      // shared parent profile works in study without any enrollment).
      navigate('/family', { replace: true });
    } else {
      // Skip the credential steps. Unlike sit (whose family-info step carries
      // the consent checkbox), study's consent lives on the shared
      // StepPassword — so the jump lands there in consent-only mode, keeping
      // exactly one consent surface on every path.
      setStep(2);
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  // The first step this user can see — back-navigation never crosses below it
  // (an add-profile user has no credential steps to go back to).
  const firstStep = isAddProfile ? 2 : 0;

  // Maps a callable error to the right UI state; returns true if it produced
  // a specialised message. There is NO account-exists branch: signup with an
  // existing email is silent (issue #148) — the backend responds like a fresh
  // signup and emails the owner.
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyInFamily'));
      return true;
    }
    if (reason === 'role-exclusive') {
      // Defense-in-depth for a direct /enroll/parent visit by a provider
      // account (tutor or sit babysitter) — the signup role page already
      // withholds the option (issue #116).
      setError(t('signup.roleExclusiveParent'));
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyParentEmail = httpsCallable(functions, 'verifyParentEmail');
      // `app` only selects the copy of the silent account-exists email
      // (issue #154) — it MUST say 'study' on every call, resends included.
      await verifyParentEmail({ email, app: 'study' });
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
      const enrollFamilyFn = httpsCallable<EnrollFamilyInput, { uid: string; familyId: string }>(
        functions,
        'enrollFamily',
      );
      const family = {
        familyName: data.familyName,
        ...(data.lastName ? { lastName: data.lastName } : {}),
        firstName: data.firstName,
        address: data.address.fullAddress,
        latLng: { lat: data.address.lat, lng: data.address.lng },
        // Geocoder components of the picked address (issue #167): persisted
        // on the family doc so tutor coverage-area matching can resolve the
        // family's arrondissement/town without a re-pick in search. Omitted
        // (not null/empty) when absent — the enrollment schema takes optional
        // strings.
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
        // credential keys makes the backend merge into the existing account.
        await enrollFamilyFn(family);
        await refreshUserDoc();
        navigate('/family');
        return;
      }

      await enrollFamilyFn({ email, verificationCode, password, ...family });

      // The account was created server-side (adminAuth) — sign the new
      // parent in NOW so the navigation lands in their portal instead of
      // bouncing to login (mirrors the tutor flow). BEST-EFFORT: enrollment
      // has already fully succeeded (account, family doc, user doc all
      // written; the verification code consumed), so a sign-in/doc-read
      // hiccup must NEVER read as an enrollment failure — worst case the
      // /family guard asks the parent to log in with the credentials they
      // just chose.
      try {
        await signInWithEmailAndPassword(auth, email, password);
        await new Promise<void>((resolve) => {
          // Resolve on auth settling (firebaseUser + !loading) — userDoc
          // can legitimately stay null when the doc read blips, and the
          // timeout backstops a store that never settles.
          const timer = setTimeout(() => { unsub(); resolve(); }, 5000);
          const check = (state: { loading: boolean; firebaseUser: unknown }) => {
            if (!state.loading && state.firebaseUser) {
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

      navigate('/family');
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
          />
        );
      case 1:
        return (
          <StepVerify
            ejemEmail={email}
            onVerify={async (code) => {
              const verifyFn = httpsCallable(functions, 'verifyCode');
              await verifyFn({ email, code });
              handleCodeVerified(code);
            }}
            onResend={async () => {
              const verifyParentEmail = httpsCallable(functions, 'verifyParentEmail');
              // Resends carry the same app hint (issue #154).
              await verifyParentEmail({ email, app: 'study' });
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
            consentVersion="2025-12-01"
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

  const isPostAuthStep = step >= AUTH_STEPS;

  return (
    <div>
      {isPostAuthStep && isAddProfile ? (
        <EnrollmentAppBar />
      ) : isPostAuthStep ? (
        // Fresh signups keep a back affordance on the family step: the
        // verification code has a 10-minute TTL that can expire while the
        // form is filled, and the only rescue is resending from the verify
        // step (sit keeps back visible on every step for the same reason).
        // Straight to verify — the draft survives, it lives in this
        // component. Add-profile users never held a code, so they keep the
        // plain enrollment bar above.
        <TopNav title={t('enrollment.parentTitle')} onBack={() => setStep(1)} />
      ) : (
        <>
          <TopNav
            title={t('enrollment.parentTitle')}
            backTo={step === firstStep ? '/' : undefined}
            onBack={step > firstStep ? handleBack : undefined}
          />
          <StepIndicator totalSteps={AUTH_STEPS} currentStep={step} />
        </>
      )}
      {renderStep()}
    </div>
  );
}
