import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, StepIndicator } from '@/components/ui';
import { StepEmail } from './babysitter/StepEmail';
import { StepVerify } from './babysitter/StepVerify';
import { StepProfile } from './babysitter/StepProfile';
import { StepPreferences } from './babysitter/StepPreferences';
import type { BabysitterUser } from '@ejm/shared';

// Kept for StepEmail compatibility
export interface BabysitterFormData {
  ejemEmail: string;
  verificationCode: string;
  password: string;
  // Legacy fields — no longer used by new steps
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: string;
  classLevel: string;
  languages: string[];
  kidAgeMin: number;
  kidAgeMax: number;
  maxKids: number;
  hourlyRate: number;
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  areaMode: 'arrondissement' | 'distance';
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: { lat: number; lng: number };
  areaRadiusKm?: number;
  photoFile?: File;
  consentAccepted: boolean;
}

export function BabysitterEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading } = useAuthStore();

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect if user is already authenticated with incomplete enrollment (resume flow)
  useEffect(() => {
    if (authLoading) return;
    if (firebaseUser && userDoc?.role === 'babysitter') {
      const babysitter = userDoc as BabysitterUser;
      if (babysitter.enrollmentComplete === false) {
        // Determine which step to resume at
        if (!babysitter.firstName) {
          setStep(2); // Need immutable fields
        } else {
          setStep(3); // Need mutable fields
        }
      } else {
        // Enrollment complete — go to dashboard
        navigate('/babysitter');
      }
    }
  }, [authLoading, firebaseUser, userDoc, navigate]);

  // StepEmail compatibility — uses the old form data interface
  const formDataForEmail = {
    ejemEmail,
    verificationCode: '',
    password: '',
    firstName: '', lastName: '', dateOfBirth: '', classLevel: '', languages: [],
    kidAgeMin: 3, kidAgeMax: 12, maxKids: 3, hourlyRate: 15,
    areaMode: 'arrondissement' as const, consentAccepted: false,
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
      setStep(1);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (code: string, password: string, consentVersion: string) => {
    setLoading(true);
    setError(null);
    try {
      const enrollFn = httpsCallable(functions, 'enrollBabysitter');
      await enrollFn({
        ejemEmail,
        verificationCode: code,
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

      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
    } catch { /* silent */ }
  };

  const handleProfileComplete = () => {
    // Refresh user doc so step 3 sees the updated data
    useAuthStore.getState().refreshUserDoc();
    setStep(3);
  };

  const handleEnrollmentComplete = () => {
    navigate('/babysitter');
  };

  const uid = firebaseUser?.uid || '';

  // Determine which step to render
  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepEmail
            data={formDataForEmail}
            onChange={(partial) => {
              if (partial.ejemEmail !== undefined) setEjemEmail(partial.ejemEmail);
            }}
            onNext={handleSendCode}
            loading={loading}
            error={error}
          />
        );
      case 1:
        return (
          <StepVerify
            ejemEmail={ejemEmail}
            onCreateAccount={handleCreateAccount}
            onResend={handleResendCode}
            loading={loading}
            error={error}
          />
        );
      case 2:
        return (
          <StepProfile
            uid={uid}
            onNext={handleProfileComplete}
          />
        );
      case 3:
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

  return (
    <div>
      <TopNav
        title={t('enrollment.babysitterTitle')}
        backTo={step === 0 ? '/' : undefined}
        onBack={step > 0 && step < 2 ? () => setStep(step - 1) : undefined}
      />
      <StepIndicator totalSteps={4} currentStep={step} />
      {renderStep()}
    </div>
  );
}
