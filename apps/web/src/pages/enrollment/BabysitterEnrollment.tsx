import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, StepIndicator } from '@/components/ui';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepEmail, StepVerify, StepPassword } from '@ejm/shared-ui';
import { StepProfile } from './babysitter/StepProfile';
import { StepPreferences } from './babysitter/StepPreferences';
import { getBabysitterProfile } from '@ejm/sit-core';


export function BabysitterEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading } = useAuthStore();

  // Steps: 0=Email, 1=Verify code, 2=Password+consent, 3=Immutable profile, 4=Mutable prefs
  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect if user is already authenticated with incomplete enrollment (resume flow)
  useEffect(() => {
    if (authLoading) return;
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
  }, [authLoading, firebaseUser, userDoc, navigate]);

  const [searchParams] = useSearchParams();
  const isInvite = searchParams.get('invite') === 'true';

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
      setStep(1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send verification code';
      setError(message);
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
    try {
      const enrollFn = httpsCallable(functions, 'enrollBabysitter');
      await enrollFn({
        ejemEmail,
        verificationCode,
        password,
        consentVersion,
      });

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
      const message = err instanceof Error ? err.message : 'Failed to create account';
      setError(message);
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
      {renderStep()}
    </div>
  );
}
