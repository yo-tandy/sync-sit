import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { TopNav, StepIndicator, StepEmail, StepVerify, StepPassword } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepProfile } from './StepProfile';
import { StepPrefs } from './StepPrefs';
import type { ProfileData } from './StepProfile';
import type { PrefsData } from './StepPrefs';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Profile, 4=Prefs.
// The visible step indicator only covers the 3 pre-account-creation
// steps (matching sync-sit's babysitter flow). After step 2 we drop
// the indicator entirely.
const AUTH_STEPS = 3;

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
            onChange={(email) => setEjemEmail(email)}
            onSubmit={handleSendCode}
            loading={loading}
            error={error}
            logoSrc="/logo.png"
            logoAlt="Sync/Study"
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
            onSubmit={async (password) => {
              handlePasswordNext(password);
            }}
            consentVersion="2025-12-01"
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

  const isPostAuthStep = step >= AUTH_STEPS;

  return (
    <div>
      {isPostAuthStep ? (
        <EnrollmentAppBar />
      ) : (
        <>
          <TopNav
            title={t('enrollment.tutorTitle')}
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
