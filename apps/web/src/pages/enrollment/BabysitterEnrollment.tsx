import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, StepIndicator } from '@/components/ui';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepEmail, StepVerify, StepPassword, enrollmentErrorReason } from '@ejm/shared-ui';
import { StepProfile } from './babysitter/StepProfile';
import { StepPreferences } from './babysitter/StepPreferences';
import { getBabysitterProfile } from '@ejm/sit-core';


export function BabysitterEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();

  // Add-profile mode: an already-authenticated user with no babysitter profile
  // yet. They still pass the EJM email gate (steps 0-1) but skip password
  // collection and account creation — enrollBabysitter merges into their
  // existing account. Users who already have a babysitter profile are handled
  // by the resume effect below (which takes precedence).
  const isAddProfile = !!firebaseUser && !getBabysitterProfile(userDoc);

  // Steps: 0=Email, 1=Verify code, 2=Password+consent, 3=Immutable profile, 4=Mutable prefs
  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When true, render the account-exists CTA (message + login link) instead of
  // the plain error string. Other failures keep using `error`.
  const [showLoginCta, setShowLoginCta] = useState(false);

  // Detect if user is already authenticated with incomplete enrollment (resume flow).
  // Guard on step === 0 so this only acts as a mount/login resume aid: once the
  // user is mid-flow it must never jump steps. Critically, in add-profile mode
  // handleCreateAccount → refreshUserDoc() adds profiles.babysitter
  // {enrollmentComplete:false} to userDoc, and add-profile users already carry a
  // top-level firstName from their other profile — without this guard the effect
  // would re-fire on that userDoc change and setStep(4), skipping StepProfile
  // (the immutable classLevel/dateOfBirth/gender step and its 15–19 age gate).
  useEffect(() => {
    if (step !== 0 || authLoading) return;
    const babysitter = getBabysitterProfile(userDoc);
    if (firebaseUser && babysitter) {
      if (babysitter.enrollmentComplete === false) {
        if (!userDoc?.firstName) {
          setStep(3); // Need immutable fields
        } else {
          setStep(4); // Need mutable fields
        }
      } else {
        navigate('/babysitter');
      }
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  const [searchParams] = useSearchParams();
  const isInvite = searchParams.get('invite') === 'true';

  // Maps a callable error to the right UI state; returns true if it produced a
  // specialised message (account-exists CTA or already-enrolled notice).
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'account-exists') {
      // The CTA block below renders the message + login link; keep `error` clear
      // so the step component doesn't duplicate the text.
      setError(null);
      setShowLoginCta(true);
      return true;
    }
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyEnrolled'));
      setShowLoginCta(false);
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    setShowLoginCta(false);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
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

  const handleCreateAccount = async (password: string, consentVersion: string) => {
    setLoading(true);
    setError(null);
    setShowLoginCta(false);
    try {
      const enrollFn = httpsCallable(functions, 'enrollBabysitter');
      await enrollFn({
        ejemEmail,
        verificationCode,
        // Add-profile mode runs in an authenticated context and merges into the
        // existing account — omit `password` entirely (not '') so the backend
        // takes the add-profile branch.
        ...(isAddProfile ? {} : { password }),
        consentVersion,
      });

      if (isAddProfile) {
        // Already signed in: skip the new-account sign-in and the auth-store
        // wait. Just refresh the user doc so the new babysitter profile is
        // visible, then continue to the immutable-profile step.
        await refreshUserDoc();
        setStep(3);
        return;
      }

      // Sign in with the new account
      await signInWithEmailAndPassword(auth, ejemEmail, password);

      // Wait for auth store to load user doc
      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) { unsub(); resolve(); }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) { unsub(); resolve(); }
      });

      setStep(3);
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to create account');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProfileComplete = () => {
    useAuthStore.getState().refreshUserDoc();
    setStep(4);
  };

  const handleEnrollmentComplete = () => {
    navigate('/babysitter');
  };

  const uid = firebaseUser?.uid || '';

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepEmail
            ejemEmail={ejemEmail}
            onChange={(email) => setEjemEmail(email)}
            onSubmit={handleSendCode}
            loading={loading}
            error={error}
            isInvite={isInvite}
            logoSrc="/logo.png"
            logoAlt="Sync/Sit"
          />
        );
      case 1:
        return (
          <StepVerify
            ejemEmail={ejemEmail}
            onVerify={async (code) => {
              const verifyFn = httpsCallable(functions, 'verifyCode');
              await verifyFn({ email: ejemEmail, code });
              handleCodeVerified(code);
            }}
            onResend={async () => {
              const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
              await verifyEjmEmail({ email: ejemEmail });
            }}
            error={error}
          />
        );
      case 2:
        return (
          <StepPassword
            collectPassword={!isAddProfile}
            onSubmit={async (password, consentVersion) => {
              await handleCreateAccount(password, consentVersion);
            }}
            consentVersion="1.0"
            loading={loading}
            error={error}
          />
        );
      case 3:
        return (
          <StepProfile
            uid={uid}
            onNext={handleProfileComplete}
          />
        );
      case 4:
        return (
          <StepPreferences
            uid={uid}
            onComplete={handleEnrollmentComplete}
          />
        );
      default:
        return null;
    }
  };

  // Wait for auth resolution before mounting the wizard: this keeps the
  // collectPassword decision and the resume redirect from being made against a
  // not-yet-known auth state (which would flicker step 2's password fields).
  if (authLoading) return null;

  const isPostAccountStep = step >= 3;

  return (
    <div>
      {isPostAccountStep ? (
        <EnrollmentAppBar />
      ) : (
        <>
          <TopNav
            title={t('enrollment.babysitterTitle')}
            backTo={step === 0 ? '/' : undefined}
            onBack={step > 0 ? () => setStep(step - 1) : undefined}
          />
          <StepIndicator totalSteps={3} currentStep={step} />
        </>
      )}
      {showLoginCta && (
        <div className="mx-auto mb-4 max-w-md px-6 text-center text-sm text-red-600">
          <p>{t('enrollment.accountExistsCta')}</p>
          <Link to="/login" className="mt-1 inline-block font-semibold text-red-600 underline">
            {t('auth.login')}
          </Link>
        </div>
      )}
      {renderStep()}
    </div>
  );
}
