import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { TopNav, StepIndicator, StepEmail, StepVerify, StepPassword, enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { getTutorProfile } from '@ejm/study-core';
import type { SubjectOffering } from '@ejm/study-core';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { EnrollmentAppBar } from '@/components/ui/EnrollmentAppBar';
import { StepSubjects } from './StepSubjects';
import type { Row as SubjectRow } from './StepSubjects';
import { StepProfile } from './StepProfile';
import type { ProfileData } from './StepProfile';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=Profile+contact, 4=Subjects.
// The profile step comes first: the issue asked to demote session
// length/location/padding — NOT the tutor's base information (issue #143 as
// clarified). Subjects is the submitting step. The old prefs step is gone:
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
  // Identity fields are absent for a cross-app add-profile caller whose doc
  // already carries them (issue #144) — the server keeps the stored values.
  enrollment: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
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

  // Root identity is set-once (issue #144): a cross-app enrollee (e.g. an
  // existing sit babysitter) already carries identity fields. PER-FIELD, like
  // sit's StepProfile: each on-file field is shown read-only and omitted from
  // the payload; a partial doc still collects only its missing fields.
  const identityOnFile = isAddProfile
    ? {
        firstName: userDoc?.firstName || undefined,
        lastName: userDoc?.lastName || undefined,
        dateOfBirth: userDoc?.dateOfBirth || undefined,
      }
    : null;

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  // Draft subject rows preserved across a back-navigation from step 4.
  const [subjectsDraft, setSubjectsDraft] = useState<SubjectRow[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // specialised message (already-enrolled notice or age gate). There is NO
  // account-exists branch: signup with an existing email is silent (issue
  // #148) — the backend responds like a fresh signup and emails the owner.
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyEnrolled'));
      return true;
    }
    const ageCode = ageGateErrorCode(err);
    if (ageCode) {
      setError(t(ageCode === 'age/under-15' ? 'enrollment.age.under15' : 'enrollment.age.mismatch'));
      return true;
    }
    return false;
  };

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
      // `app` only selects the copy of the silent account-exists email.
      await verifyEjmEmail({ email: ejemEmail, app: 'study' });
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
      if (isAddProfile) {
        await refreshUserDoc();
      } else {
        // The account was created server-side (adminAuth) — sign the new
        // tutor in NOW so the success page's CTA lands in their portal
        // instead of bouncing to login (mirrors sit's babysitter flow).
        // BEST-EFFORT: enrollment has already fully succeeded (account,
        // user doc, schedule all written; the verification code consumed),
        // so a sign-in/doc-read hiccup must NEVER read as an enrollment
        // failure or block the success page — worst case the CTA asks the
        // tutor to log in with the credentials they just chose.
        try {
          await signInWithEmailAndPassword(auth, ejemEmail, password);
          await new Promise<void>((resolve) => {
            // Resolve on auth settling (firebaseUser + !loading) — userDoc
            // can legitimately stay null when the doc read blips, and the
            // timeout backstops a store that never settles.
            const timer = setTimeout(() => { unsub(); resolve(); }, 5000);
            const check = (state: { loading: boolean; firebaseUser: unknown }) => {
              if (!state.loading && state.firebaseUser) {
                clearTimeout(timer);
                unsub();
                resolve();
              }
            };
            const unsub = useAuthStore.subscribe(check);
            check(useAuthStore.getState());
          });
        } catch {
          // Swallowed by design — see above.
        }
      }
      navigate('/enroll/tutor/success', {
        state: { firstName: profileData.firstName ?? identityOnFile?.firstName },
      });

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
              await verifyEjmEmail({ email: ejemEmail, app: 'study' });
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
        return (
          <StepProfile
            onNext={handleProfileNext}
            initial={profile}
            serverError={error}
            identityOnFile={identityOnFile}
          />
        );
      case 4:
        return (
          <StepSubjects
            onNext={handleSubjectsNext}
            loading={loading}
            error={error}
            initialRows={subjectsDraft}
            onBack={(rows) => {
              setSubjectsDraft(rows);
              // Keep the server error: the field it names is on the step the
              // user is going back TO — clearing it left them guessing.
              setStep(3);
            }}
          />
        );
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
      {renderStep()}
    </div>
  );
}
