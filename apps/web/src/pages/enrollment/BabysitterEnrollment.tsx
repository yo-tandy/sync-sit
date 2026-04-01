import { useState } from 'react';
import { useNavigate } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, functions, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, StepIndicator } from '@/components/ui';
import { StepEmail } from './babysitter/StepEmail';
import { StepVerify } from './babysitter/StepVerify';
import { StepProfile } from './babysitter/StepProfile';
import { StepPreferences } from './babysitter/StepPreferences';

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

const INITIAL_DATA: BabysitterFormData = {
  ejemEmail: '',
  verificationCode: '',
  password: '',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: undefined,
  classLevel: '',
  languages: [],
  kidAgeMin: 3,
  kidAgeMax: 12,
  maxKids: 3,
  hourlyRate: 15,
  aboutMe: '',
  contactEmail: '',
  contactPhone: '',
  areaMode: 'arrondissement',
  arrondissements: [],
  areaAddress: '',
  areaRadiusKm: 3,
  consentAccepted: false,
};

export function BabysitterEnrollment() {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<BabysitterFormData>(INITIAL_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const updateData = (partial: Partial<BabysitterFormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
    setError(null);
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: formData.ejemEmail });
      setStep(1);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndContinue = () => {
    setError(null);
    setStep(2);
  };

  const handleProfileContinue = () => {
    setError(null);
    if (!formData.contactEmail) {
      updateData({ contactEmail: formData.ejemEmail });
    }
    setStep(3);
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      // Upload photo if provided
      let photoUrl: string | null = null;
      if (formData.photoFile) {
        const ext = formData.photoFile.name.split('.').pop() || 'jpg';
        const path = `profile-photos/${formData.ejemEmail.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, formData.photoFile);
        photoUrl = await getDownloadURL(storageRef);
      }

      const { photoFile: _removed, ...payload } = formData;
      const enrollBabysitter = httpsCallable(functions, 'enrollBabysitter');
      await enrollBabysitter({ ...payload, photoUrl });

      // Sign in with the new account
      await signInWithEmailAndPassword(auth, formData.ejemEmail, formData.password);

      // Wait for auth store to fully load the user doc before navigating
      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) {
            unsub();
            resolve();
          }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) {
          unsub();
          resolve();
        }
      });

      navigate('/babysitter');
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    <StepEmail
      key="email"
      data={formData}
      onChange={updateData}
      onNext={handleSendCode}
      loading={loading}
      error={error}
    />,
    <StepVerify
      key="verify"
      data={formData}
      onChange={updateData}
      onNext={handleVerifyAndContinue}
      onResend={handleSendCode}
      loading={loading}
      error={error}
    />,
    <StepProfile
      key="profile"
      data={formData}
      onChange={updateData}
      onNext={handleProfileContinue}
      error={error}
    />,
    <StepPreferences
      key="preferences"
      data={formData}
      onChange={updateData}
      onNext={handleComplete}
      loading={loading}
      error={error}
    />,
  ];

  return (
    <div>
      <TopNav
        title="Sync/Sit - Babysitter Sign Up"
        backTo={step === 0 ? '/' : undefined}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
      />
      <StepIndicator totalSteps={4} currentStep={step} />
      {steps[step]}
    </div>
  );
}
