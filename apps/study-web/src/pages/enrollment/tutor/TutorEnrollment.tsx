import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { TopNav, StepIndicator, StepEmail, StepVerify, StepPassword, enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { getTutorProfile } from '@ejm/study-core';
import type { SubjectOffering } from '@ejm/study-core';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepSubjects } from './StepSubjects';
import { StepProfile } from './StepProfile';
import type { ProfileData } from './StepProfile';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Profile+contact, 4=Subjects.
// Subjects come first after auth (issue #143) — they are the primary
// information families search by. The old prefs step is gone: session
// lengths/locations/padding/area get server defaults at enrollment and stay
// editable at /tutor/account and /tutor/area.
// The visible step indicator only covers the 3 pre-account-creation
// steps (matching sync-sit's babysitter flow). After step 2 we drop
// the indicator entirely.
const AUTH_STEPS = 3;

interface EnrollTutorInput {
  ejemEmail: string;
  verificationCode: string;
  password?: string;
  consentVersion: string;
  // Pref fields (sessionLengthsMin/locationPrefs/paddingMin/area*) are
  // intentionally ABSENT: the server defaults them (withPrefDefaults).
  enrollment: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    classLevel: string;
    gender?: string;
    subjects: SubjectOffering[];
    contactEmail?: string;
    contactPhone?: string;
  };
}

export function TutorEnrollment() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
  const isAddProfile = !!firebaseUser;

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When true, render the account-exists CTA (message + login link) instead of
  // the plain error string. Other failures keep using `error`.
  const [showLoginCta, setShowLoginCta] = useState(false);

  // Already-enrolled tutors have nothing to add here — send them home. Guard on
  // step === 0 so this only fires before the flow starts: after an add-profile
  // success, refreshUserDoc() adds profiles.tutor to userDoc, and this effect
  // must NOT hijack the success navigation.
  useEffect(() => {
    if (step === 0 && !authLoading && firebaseUser && getTutorProfile(userDoc)) {
      navigate('/', { replace: true });
    }
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

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
    const ageCode = ageGateErrorCode(err);
    if (ageCode) {
      setError(t(ageCode === 'age/under-15' ? 'enrollment.age.under15' : 'enrollment.age.mismatch'));
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

  const handlePasswordNext = (pw: string) => {
    setPassword(pw);
    setError(null);
    setStep(3);
  };

  const handleProfileNext = (profileData: ProfileData) => {
    setProfile(profileData);
    setError(null);
    setStep(4);
  };

  const handleSubjectsNext = async (data: SubjectOffering[]) => {
    if (!profile) return;
    const profileData = profile;
    setLoading(true);
    setError(null);
    setShowLoginCta(false);
    try {
      const enrollTutorFn = httpsCallable<EnrollTutorInput, { uid: string }>(functions, 'enrollTutor');
      // Firebase v2 callable client serializes undefined as null on the wire,
      // which breaks server-side Zod .optional() validation. Strip undefined
      // keys via JSON round-trip so the schema sees the field as absent
      // (which .optional() handles) rather than as null (which it rejects).
      // The dropped pref fields are NOT sent at all — the server defaults them.
      const enrollmentRaw = {
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        dateOfBirth: profileData.dateOfBirth,
        classLevel: profileData.classLevel,
        gender: profileData.gender,
        subjects: data,
        contactEmail: profileData.contactEmail,
        contactPhone: profileData.contactPhone,
      };
      const enrollment = JSON.parse(JSON.stringify(enrollmentRaw)) as typeof enrollmentRaw;
      await enrollTutorFn({
        ejemEmail,
        verificationCode,
        // Add-profile mode runs against an authenticated context and merges into
        // the existing account — omit `password` entirely (not '') so the
        // backend takes the add-profile branch.
        ...(isAddProfile ? {} : { password }),
        consentVersion: '2025-12-01',
        enrollment,
      });
      if (isAddProfile) await refreshUserDoc();
      navigate('/enroll/tutor/success', { state: { firstName: profileData.firstName } });

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
            collectPassword={!isAddProfile}
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
        return <StepSubjects onNext={handleSubjectsNext} loading={loading} error={error} />;
      default:
        return null;
    }
  };

  // Wait for auth resolution before mounting the wizard: this keeps the
  // collectPassword decision and the already-a-tutor redirect from being made
  // against a not-yet-known auth state (which would flicker step 2).
  if (authLoading) return null;

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
      {showLoginCta && (
        <div className="mx-auto mb-4 max-w-md px-6 text-center text-sm text-brand-600">
          <p>{t('enrollment.accountExistsCta')}</p>
          <Link to="/login" className="mt-1 inline-block font-semibold text-brand-600 underline">
            {t('auth.login')}
          </Link>
        </div>
      )}
      {renderStep()}
    </div>
  );
}
