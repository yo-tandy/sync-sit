import { useState } from 'react';
import { useNavigate } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
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
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<ParentFormData>(INITIAL_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const updateData = (partial: Partial<ParentFormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
    setError(null);
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      await verifyEmail({ email: formData.email });
      setStep(1);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
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
      await enrollFamily({
        ...formData,
        kids: [],
        address: formData.address?.fullAddress || '',
        latLng: formData.address
          ? { lat: formData.address.lat, lng: formData.address.lng }
          : { lat: 48.8566, lng: 2.3522 },
      });

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
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
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
