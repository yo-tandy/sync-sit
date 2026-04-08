import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, StepIndicator } from '@/components/ui';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepEmail } from './babysitter/StepEmail';
import { StepVerify } from './babysitter/StepVerify';
import { StepPassword } from './babysitter/StepPassword';
import { StepProfile } from './babysitter/StepProfile';
import { StepPreferences } from './babysitter/StepPreferences';
import type { BabysitterUser } from '@ejm/shared';

// Kept for StepEmail compatibility
export interface BabysitterFormData {
  ejemEmail: string;
  verificationCode: string;
  password: string;
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

  // Steps: 0=Email, 1=Verify code, 2=Password+consent, 3=Immutable profile, 4=Mutable prefs
  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect if user is already authenticated with incomplete enrollment (resume flow)
  useEffect(() => {
    if (authLoading) return;
    if (firebaseUser && userDoc?.role === 'babysitter') {
      const babysitter = userDoc as BabysitterUser;
      if (babysitter.enrollmentComplete === false) {
        if (!babysitter.firstName) {
          setStep(3); // Need immutable fields
        } else {
          setStep(4); // Need mutable fields
        }
      } else {
        navigate('/babysitter');
      }
    }
  }, [authLoading, firebaseUser, userDoc, navigate]);

  // StepEmail compatibility
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
            onVerified={handleCodeVerified}
            onResend={handleResendCode}
            error={error}
          />
        );
      case 2:
        return (
          <StepPassword
            onCreateAccount={handleCreateAccount}
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
        <>
          <EnrollmentAppBar />
          <div className="px-5 pt-3 pb-1">
            <h2 className="text-lg font-bold text-gray-900">{t('enrollment.babysitterTitle')}</h2>
          </div>
        </>
      ) : (
        <TopNav
          title={t('enrollment.babysitterTitle')}
          backTo={step === 0 ? '/' : undefined}
          onBack={step > 0 ? () => setStep(step - 1) : undefined}
        />
      )}
      <StepIndicator totalSteps={5} currentStep={step} />
      {renderStep()}
    </div>
  );
}
