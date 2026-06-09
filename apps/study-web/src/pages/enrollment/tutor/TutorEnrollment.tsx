import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { StepEmail } from './StepEmail';
import { StepVerify } from './StepVerify';
import { StepPassword } from './StepPassword';
import { StepProfile } from './StepProfile';
import { StepPrefs } from './StepPrefs';
import type { ProfileData } from './StepProfile';
import type { PrefsData } from './StepPrefs';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Profile, 4=Prefs
const TOTAL_STEPS = 5;

interface EnrollTutorInput {
  ejemEmail: string;
  verificationCode: string;
  password: string;
  consentVersion: string;
  enrollment: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    classLevel: string;
    gender?: string;
    subjects: never[];
    sessionLengthsMin: number[];
    locationPrefs: string[];
    paddingMin: number;
    aboutMe?: string;
    contactEmail?: string;
    contactPhone?: string;
    areaMode: 'arrondissement' | 'distance';
    arrondissements?: string[];
    areaAddress?: string;
    areaRadiusKm?: number;
  };
}

export function TutorEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
      setStep(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeVerified = (code: string) => {
    setVerificationCode(code);
    setError(null);
    setStep(2);
  };

  const handleResendCode = async () => {
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      await verifyEjmEmail({ email: ejemEmail });
    } catch { /* silent */ }
  };

  const handlePasswordNext = (pw: string) => {
    setPassword(pw);
    setError(null);
    setStep(3);
  };

  const handleProfileNext = (data: ProfileData) => {
    setProfileData(data);
    setStep(4);
  };

  const handlePrefsNext = async (prefsData: PrefsData) => {
    if (!profileData) return;
    setLoading(true);
    setError(null);
    try {
      const enrollTutorFn = httpsCallable<EnrollTutorInput, { uid: string }>(functions, 'enrollTutor');
      // Firebase v2 callable client serializes undefined as null on the wire,
      // which breaks server-side Zod .optional() validation. Strip undefined
      // keys via JSON round-trip so the schema sees the field as absent
      // (which .optional() handles) rather than as null (which it rejects).
      const enrollmentRaw = {
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        dateOfBirth: profileData.dateOfBirth,
        classLevel: profileData.classLevel,
        gender: profileData.gender,
        subjects: [] as never[],
        sessionLengthsMin: prefsData.sessionLengthsMin,
        locationPrefs: prefsData.locationPrefs,
        paddingMin: prefsData.paddingMin,
        aboutMe: prefsData.aboutMe,
        contactEmail: prefsData.contactEmail,
        contactPhone: prefsData.contactPhone,
        areaMode: prefsData.areaMode,
        arrondissements: prefsData.arrondissements,
        areaAddress: prefsData.areaAddress,
        areaRadiusKm: prefsData.areaRadiusKm,
      };
      const enrollment = JSON.parse(JSON.stringify(enrollmentRaw)) as typeof enrollmentRaw;
      await enrollTutorFn({
        ejemEmail,
        verificationCode,
        password,
        consentVersion: '2025-12-01',
        enrollment,
      });
      navigate('/enroll/tutor/success', { state: { firstName: profileData.firstName } });

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Enrollment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepEmail
            ejemEmail={ejemEmail}
            onChange={setEjemEmail}
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
            onNext={handlePasswordNext}
            loading={loading}
            error={error}
          />
        );
      case 3:
        return <StepProfile onNext={handleProfileNext} />;
      case 4:
        return (
          <StepPrefs
            onNext={handlePrefsNext}
            loading={loading}
            error={error}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      {/* Top nav */}
      <div className="flex h-[52px] items-center justify-between px-5">
        <button
          type="button"
          onClick={step === 0 ? () => navigate('/') : handleBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <span className="text-sm">←</span>
        </button>
        <span className="text-base font-semibold">{t('enrollment.tutor.title')}</span>
        <div className="w-9" />
      </div>

      {/* Step indicator */}
      <div className="mb-6 flex gap-1 px-5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? 'bg-red-600' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {renderStep()}
    </div>
  );
}
