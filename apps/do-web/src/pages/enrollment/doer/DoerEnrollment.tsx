import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  TopNav,
  StepIndicator,
  StepEmail,
  StepVerify,
  StepPassword,
  enrollmentErrorReason,
  ageGateErrorCode,
} from '@ejm/shared-ui';
import { ADMIN_CONFIG_DEFS, hasAnyContact, type User } from '@ejm/shared-core';
import { getDoerProfile, type TaskCategory } from '@ejm/do-core';
import { auth, functions } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { useClientConfigValue } from '@/lib/adminConfigClient';
import { ensureDoerProfileLoaded } from '@/lib/ensureDoerProfileLoaded';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepProfile } from './StepProfile';
import type { ProfileData } from './StepProfile';
import { StepDoerDetails } from './StepDoerDetails';
import type { DoerDetailsData } from './StepDoerDetails';

/** Version of the sync-do terms the consent tick accepts (recorded by
 * doEnrollDoer as consentAt/consentVersion, plan §11.4). */
const CONSENT_VERSION = '2026-08-28';

type StepId = 'email' | 'verify' | 'consent' | 'profile' | 'details';

interface EnrollDoerInput {
  ejemEmail?: string;
  verificationCode?: string;
  password?: string;
  consentVersion: string;
  crossApp?: boolean;
  enrollment: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    contactEmail?: string;
    contactPhone?: string;
    categories: TaskCategory[];
    bio?: string;
    defaultRate?: number | null;
    hasCar: boolean;
    hasBike: boolean;
    notifyNewTasks: boolean;
  };
}

/** A completed sit/study PROVIDER profile — the §11.1 abbreviated identity:
 * EJM-email-verified when it was made, so the wizard skips email
 * verification and password entirely (§3.3). A parent profile deliberately
 * does NOT count (any-domain self-signup — §11.1 as corrected in PR #320):
 * a parent-only account gets the code-verified sequence, which requires a
 * genuine EJM address. */
function hasVerifiedCrossAppProfile(userDoc: User | null): boolean {
  const profiles = userDoc?.profiles;
  return !!(
    profiles?.babysitter?.enrollmentComplete === true ||
    profiles?.tutor?.enrollmentComplete === true
  );
}

/**
 * Doer enrollment wizard (plan §13 PR4, §3.3, §9.2) — the study
 * TutorEnrollment shape, with the doer-specific details step and the
 * ABBREVIATED cross-app path folded in:
 *
 * - signed out (classic): email → verify → password+consent → profile →
 *   details (submitting step).
 * - signed in WITHOUT a completed provider profile (a governed kid, or a
 *   parent — parent profiles don't satisfy the identity gate, PR #320):
 *   same, minus the password inputs (consent only).
 * - signed in WITH a completed sit/study PROVIDER profile (cross-app,
 *   §3.3): consent → [profile, only when identity fields are missing —
 *   typically a sit doc without a DOB, which the §11.1 gate requires — or
 *   when the account has NO contact channel, which the callable requires
 *   on every path (PR #320)] → details. No email step, no code, no
 *   password; contact is re-collected only when the account has none.
 */
export function DoerEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
  const isAddProfile = !!firebaseUser;
  const isCrossApp = isAddProfile && hasVerifiedCrossAppProfile(userDoc);
  const governed = !!userDoc?.governedBy;

  // Root identity is set-once (issue #144): PER-FIELD, each on-file field is
  // shown read-only and omitted from the payload; a partial doc still
  // collects only its missing fields (a sit-created doc may lack a DOB).
  const identityOnFile = isAddProfile
    ? {
        firstName: userDoc?.firstName || undefined,
        lastName: userDoc?.lastName || undefined,
        dateOfBirth: userDoc?.dateOfBirth || undefined,
      }
    : null;
  const identityComplete = !!(
    identityOnFile?.firstName && identityOnFile?.lastName && identityOnFile?.dateOfBirth
  );
  // The callable requires ≥1 contact channel on EVERY path (the enrollTutor
  // precedent — decision 16's reveal must have something to serve), and
  // sit's enrollment makes contact skippable, so a cross-app account can
  // genuinely carry none. hasAnyContact runs the canonical root ?? nested
  // resolution the server uses.
  const accountHasContact = isAddProfile && hasAnyContact(userDoc);

  // The step SEQUENCE for this caller. Cross-app skips email/verify (the
  // identity was verified when the provider profile was made) and skips the
  // profile step when nothing is missing — §3.3: "collect only categories,
  // transport, bio, consent". "Missing" covers identity AND a zero-channel
  // account: the profile step is the per-field collector for both.
  const crossAppNeedsProfileStep = !identityComplete || !accountHasContact;
  const computedSteps: StepId[] = isCrossApp
    ? ['consent', ...(crossAppNeedsProfileStep ? ['profile' as StepId] : []), 'details']
    : ['email', 'verify', 'consent', 'profile', 'details'];
  // FROZEN once auth resolves (PR #320 round 2): the sequence derives from
  // live userDoc state while `step` is a plain index into it, and mid-flow
  // snapshot updates genuinely shrink it — the post-submit refresh persists
  // the very DOB/contact whose absence put 'profile' in the array, flipping
  // crossAppNeedsProfileStep false and making steps[2] undefined for the
  // frames before navigate('/doer'). The sibling wizards' sequences are
  // static by construction; freezing at auth-resolution pins the same
  // property for this derived one. (Not frozen at MOUNT: the wizard mounts
  // during authLoading, when the shape would be computed against a
  // not-yet-known auth state — the same reason renderStep waits below.)
  const [frozenSteps, setFrozenSteps] = useState<StepId[] | null>(null);
  useEffect(() => {
    if (!authLoading && frozenSteps === null) setFrozenSteps(computedSteps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);
  const steps = frozenSteps ?? computedSteps;
  // The visible indicator covers only the pre-account-creation steps
  // (matching sit and study); cross-app has none of them.
  const AUTH_STEPS = isCrossApp ? 0 : 3;

  const resendCooldownS = useClientConfigValue(
    'verificationCodeCooldownS',
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS,
  );

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<DoerDetailsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enrollment succeeded server-side but the settled session cannot prove
  // profiles.doer yet (sign-in failed, or the user-doc read blipped):
  // confirm success in-wizard rather than bouncing through a guard (the
  // study PR #257 pattern). 'login' = signed OUT; 'profileLoad' = signed IN
  // but the doc has not surfaced (the CTA retries the read; the
  // auto-advance below resolves it hands-free when the snapshot lands).
  const [signedOutSuccess, setSignedOutSuccess] = useState<false | 'login' | 'profileLoad'>(false);
  const [retrying, setRetrying] = useState(false);
  const [retryMissed, setRetryMissed] = useState(false);

  const retryProfileLoad = async () => {
    setRetrying(true);
    setRetryMissed(false);
    try {
      if (await ensureDoerProfileLoaded(refreshUserDoc)) {
        navigate('/doer');
      } else {
        setRetryMissed(true);
      }
    } finally {
      setRetrying(false);
    }
  };

  // While the fallback state shows, keep listening: the store's snapshot
  // listener is still live — auto-advance the moment the doer profile is
  // readable instead of parking a signed-in doer on a login CTA.
  useEffect(() => {
    if (!signedOutSuccess) return;
    const check = (s: { firebaseUser: unknown; userDoc: User | null }) => {
      if (s.firebaseUser && getDoerProfile(s.userDoc)) navigate('/doer');
    };
    // Check the CURRENT state before subscribing — zustand's subscribe only
    // fires on subsequent changes.
    check(useAuthStore.getState());
    return useAuthStore.subscribe(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOutSuccess]);

  // Already-enrolled doers have nothing to add here — send them home. Guard
  // on step === 0 so this only fires before the flow starts.
  useEffect(() => {
    if (step === 0 && !authLoading && firebaseUser && getDoerProfile(userDoc)) {
      navigate('/doer', { replace: true });
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyEnrolled'));
      return true;
    }
    if (reason === 'send-cap') {
      setError(t('enrollment.sendCapReached'));
      return true;
    }
    const ageCode = ageGateErrorCode(err);
    if (ageCode) {
      setError(t(ageCode === 'age/under-15' ? 'enrollment.age.under15' : 'enrollment.age.mismatch'));
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      // `app` only selects the copy of the silent account-exists email.
      await verifyEjmEmail({ email: ejemEmail, app: 'do' });
      setStep(step + 1);
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to send verification code');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDetailsNext = async (details: DoerDetailsData) => {
    setDetailsDraft(details);
    setLoading(true);
    setError(null);
    try {
      const enrollFn = httpsCallable<EnrollDoerInput, { uid: string }>(functions, 'doEnrollDoer');
      // Strip undefined keys via JSON round-trip: the callable client
      // serializes undefined as null on the wire, and the server's guards
      // read absence, not null (the study wizard's idiom).
      const enrollmentRaw = {
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        dateOfBirth: profile?.dateOfBirth,
        contactEmail: profile?.contactEmail,
        contactPhone: profile?.contactPhone,
        categories: details.categories,
        bio: details.bio,
        defaultRate: details.defaultRate,
        hasCar: details.hasCar,
        hasBike: details.hasBike,
        notifyNewTasks: details.notifyNewTasks,
      };
      const enrollment = JSON.parse(JSON.stringify(enrollmentRaw)) as typeof enrollmentRaw;
      await enrollFn({
        ...(isCrossApp
          ? { crossApp: true }
          : { ejemEmail: ejemEmail.trim().toLowerCase(), verificationCode }),
        // Omit `password` entirely (not '') on any authenticated path so the
        // backend takes the add-profile branch.
        ...(isAddProfile ? {} : { password }),
        consentVersion: CONSENT_VERSION,
        enrollment,
      });
      if (isAddProfile) {
        // Already signed in; refresh pulls the fresh doer profile so the board's
        // guard resolves. Both reads are best-effort — enrollment has
        // already succeeded.
        if (await ensureDoerProfileLoaded(refreshUserDoc)) {
          navigate('/doer');
        } else {
          setSignedOutSuccess('profileLoad');
        }
        return;
      }
      // New account created server-side (adminAuth) — sign in NOW so
      // completion lands in the shell. Best-effort for the ENROLLMENT: a
      // sign-in/doc-read hiccup must never read as an enrollment failure.
      try {
        markNextSignInFresh();
        await signInWithEmailAndPassword(auth, ejemEmail.trim().toLowerCase(), password);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { unsub(); resolve(); }, 5000);
          const check = (state: { loading: boolean; firebaseUser: unknown; userDoc: User | null }) => {
            if (!state.loading && state.firebaseUser && getDoerProfile(state.userDoc)) {
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
      let settled = useAuthStore.getState();
      if (settled.firebaseUser && !getDoerProfile(settled.userDoc)) {
        // Timed out with a live session but no doc yet: one explicit
        // recovery pass before telling the user anything.
        await ensureDoerProfileLoaded(refreshUserDoc);
        settled = useAuthStore.getState();
      }
      if (settled.firebaseUser && getDoerProfile(settled.userDoc)) {
        navigate('/doer');
      } else {
        setSignedOutSuccess(settled.firebaseUser ? 'profileLoad' : 'login');
      }
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Enrollment failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const renderStep = () => {
    switch (steps[step]) {
      case 'email':
        return (
          <StepEmail
            ejemEmail={ejemEmail}
            onChange={(email) => setEjemEmail(email)}
            onSubmit={handleSendCode}
            loading={loading}
            error={error}
            logoSrc="/logo.png"
            logoAlt="Sync/Do"
          />
        );
      case 'verify':
        return (
          <StepVerify
            resendCooldownS={resendCooldownS}
            ejemEmail={ejemEmail}
            onVerify={async (code) => {
              const verifyFn = httpsCallable(functions, 'verifyCode');
              await verifyFn({ email: ejemEmail, code });
              setVerificationCode(code);
              setError(null);
              setStep(step + 1);
            }}
            onResend={async () => {
              const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
              await verifyEjmEmail({ email: ejemEmail, app: 'do' });
            }}
            error={error}
          />
        );
      case 'consent':
        return (
          <StepPassword
            collectPassword={!isAddProfile}
            onSubmit={async (pw) => {
              setPassword(pw);
              setError(null);
              setStep(step + 1);
            }}
            consentVersion={CONSENT_VERSION}
            loading={loading}
            error={error}
          />
        );
      case 'profile':
        return (
          <StepProfile
            onNext={(data) => {
              setProfile(data);
              setError(null);
              setStep(step + 1);
            }}
            initial={profile}
            serverError={error}
            identityOnFile={identityOnFile}
            governed={governed}
            // Contact is skipped on the abbreviated path ONLY when the
            // account already has a channel — the callable requires ≥1 on
            // every path (PR #320 round 1).
            collectContact={!isCrossApp || !accountHasContact}
          />
        );
      case 'details':
        return (
          <StepDoerDetails
            onNext={handleDetailsNext}
            loading={loading}
            error={error}
            initial={detailsDraft}
            onBack={
              step > 0
                ? (draft) => {
                    setDetailsDraft(draft);
                    // Keep the server error: the field it names is usually on
                    // the step the user is going back TO.
                    setStep(step - 1);
                  }
                : undefined
            }
          />
        );
      default:
        return null;
    }
  };

  // Wait for auth resolution before mounting the wizard: the step sequence,
  // collectPassword and the already-a-doer redirect all depend on it.
  if (authLoading) return null;

  if (signedOutSuccess) {
    const isProfileLoadFallback = signedOutSuccess === 'profileLoad';
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-3 text-2xl font-bold text-gray-950">
          {t('enrollment.doer.readyLoginTitle')}
        </h1>
        <p className="mb-8 max-w-[300px] text-sm leading-relaxed text-gray-500">
          {t(isProfileLoadFallback ? 'enrollment.doer.readyAddProfileDesc' : 'enrollment.doer.readyLoginDesc')}
        </p>
        <button
          type="button"
          disabled={retrying}
          onClick={() => (isProfileLoadFallback ? retryProfileLoad() : navigate('/login'))}
          className="flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-600/90 disabled:opacity-50"
        >
          {retrying
            ? t('common.loading')
            : t(isProfileLoadFallback ? 'enrollment.doer.readyAddProfileCta' : 'enrollment.doer.readyLoginCta')}
        </button>
        {retryMissed && !retrying && (
          <p className="mt-3 text-xs text-gray-500">{t('enrollment.doer.readyRetryMiss')}</p>
        )}
      </div>
    );
  }

  const isPostAuthStep = step >= AUTH_STEPS;

  return (
    <div>
      {isPostAuthStep ? (
        <EnrollmentAppBar />
      ) : (
        <>
          <TopNav
            title={t('enrollment.doerTitle')}
            backTo={step === 0 ? '/' : undefined}
            onBack={step > 0 ? handleBack : undefined}
          />
          <StepIndicator totalSteps={AUTH_STEPS} currentStep={step} />
        </>
      )}
      {renderStep()}
    </div>
  );
}
