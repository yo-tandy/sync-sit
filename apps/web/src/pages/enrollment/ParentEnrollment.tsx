import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/sit-core';
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

      await signInWithEmailAndPassword(auth, formData.email, formData.password);

      // Wait for auth store to fully load the user doc before navigating
      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) {
            unsub();
            resolve();
          }
        });
        // Also check current state immediately
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) {
          unsub();
          resolve();
        }
      });

      navigate('/family');
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
