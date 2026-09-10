import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import { getSitRole } from '@ejm/sit-core';
import {
  StepEmail,
  StepVerify,
  StepPassword,
  StepBasicInfo,
  StepContactInfo,
  StepAdditionalInfo,
  enrollmentErrorReason,
  ageGateErrorCode,
  type BasicInfoData,
  type ContactInfoData,
  type AdditionalInfoData,
} from '@ejm/shared-ui';
import { useClientConfigValue } from '@/lib/adminConfigClient';
import { auth, db, functions, storage } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { TopNav, StepIndicator } from '@/components/ui';

// Same consent version sit's classic wizard passes to StepPassword — the
// unified flow's account creation happens on sync-sit.com, same convention.
const CONSENT_VERSION = '1.0';

// Steps: 0=Email, 1=Verify, 2=Password+consent, 3=BasicInfo, 4=ContactInfo,
// 5=AdditionalInfo (submitting step — creates the account).
const TOTAL_STEPS = 6;

/**
 * The unified flow's student orchestrator (issue #435 milestone, PR4,
 * `/enroll/student`): collects a full identity — email/verify/password,
 * then name/DOB/classLevel/gender, contact, and optional extras — and
 * creates a ROOT-ONLY account (`enrollStudentIdentity`, no role profile at
 * all) BEFORE the user has picked sit or study. `/enroll/choose-app` is
 * where that choice happens; this page's only job is to get the user to an
 * authenticated, EJM-verified identity.
 *
 * Mirrors `BabysitterEnrollment`'s/`TutorEnrollment`'s classic shape
 * (email → verify → password → …), but password is collected and stored
 * locally without triggering account creation (like `TutorEnrollment`,
 * where the submitting step is the LAST one, not password) — this flow has
 * no role-specific final step, so the account is created after
 * `StepAdditionalInfo`, using everything collected so far.
 */
export function StudentEnrollment() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading } = useAuthStore();

  const resendCooldownS = useClientConfigValue(
    'verificationCodeCooldownS',
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS,
  );

  const [step, setStep] = useState(0);
  const [ejemEmail, setEjemEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [basicInfo, setBasicInfo] = useState<BasicInfoData | null>(null);
  const [contactInfo, setContactInfo] = useState<ContactInfoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An already-authenticated visitor (direct URL, browser back, a bookmark)
  // never sees the identity steps again: a role sends them to their portal,
  // a study tutor to the one-tap sit welcome, and a root-only identity
  // (this flow's own account creation, abandoned before the app choice)
  // straight back to /enroll/choose-app — postLoginRouter already encodes
  // all three (issue #435 milestone, PR4). Guarded on step === 0 so this
  // only acts as a mount/login-resume aid, matching BabysitterEnrollment's
  // identical resume-guard convention: once mid-flow, the just-created
  // session firing this effect again must never rip the user out of
  // StepAdditionalInfo's in-flight (non-blocking) photo upload.
  useEffect(() => {
    if (step !== 0 || authLoading || !firebaseUser) return;
    navigate(postLoginRouter(getSitRole(userDoc), userDoc), { replace: true });
  }, [step, authLoading, firebaseUser, userDoc, navigate]);

  // Maps a callable error to translated UI copy; returns true if it produced
  // one. Mirrors BabysitterEnrollment's/TutorEnrollment's identical helper.
  // No account-exists branch: signup with an existing email is silent
  // (issue #148) — surfaced only via verifyEjmEmail's decoy-success path at
  // step 0, never here.
  const applyEnrollmentError = (err: unknown): boolean => {
    if (enrollmentErrorReason(err) === 'send-cap') {
      setError(t('enrollment.sendCapReached'));
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
      await verifyEjmEmail({ email: ejemEmail, app: 'sit' });
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

  const handlePasswordNext = async (pw: string) => {
    setPassword(pw);
    setError(null);
    setStep(3);
  };

  const handleBasicInfoNext = (data: BasicInfoData) => {
    setBasicInfo(data);
    setStep(4);
  };

  const handleContactInfoNext = (data: ContactInfoData) => {
    setContactInfo(data);
    setStep(5);
  };

  const handleAdditionalInfoNext = async (additional: AdditionalInfoData) => {
    if (!basicInfo || !contactInfo) return; // unreachable: steps are sequential
    setLoading(true);
    setError(null);
    try {
      const enrollFn = httpsCallable(functions, 'enrollStudentIdentity');
      await enrollFn({
        ejemEmail,
        verificationCode,
        password,
        consentVersion: CONSENT_VERSION,
        firstName: basicInfo.firstName,
        lastName: basicInfo.lastName,
        dateOfBirth: basicInfo.dateOfBirth,
        classLevel: basicInfo.classLevel,
        gender: basicInfo.gender,
        contactEmail: contactInfo.contactEmail,
        contactPhone: contactInfo.contactPhone,
        whatsapp: contactInfo.whatsapp,
        contactVisibilityConsent: contactInfo.contactVisibilityConsent,
        bio: additional.bio,
        address: additional.address,
        language: i18n.language?.startsWith('fr') ? 'fr' : 'en',
      });

      // Fresh, deliberate sign-in: capture the session epoch anew (issue #181).
      markNextSignInFresh();
      await signInWithEmailAndPassword(auth, ejemEmail, password);

      // Wait for the auth store to load the fresh user doc before doing
      // anything that reads it (the photo upload's uid) or navigating.
      const uid = await new Promise<string>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc && state.firebaseUser) {
            unsub();
            resolve(state.firebaseUser.uid);
          }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc && current.firebaseUser) {
          unsub();
          resolve(current.firebaseUser.uid);
        }
      });

      // Photo upload is BEST-EFFORT and non-blocking (task brief): the
      // account already exists either way, and a photo can always be added
      // later from account settings — a Storage hiccup here must never
      // read as an enrollment failure.
      if (additional.photoFile) {
        try {
          const ext = (
            additional.photoFile.name.includes('.') ? additional.photoFile.name.split('.').pop()! : 'jpg'
          ).toLowerCase();
          const storageRef = ref(storage, `profile-photos/${uid}.${ext}`);
          await uploadBytes(storageRef, additional.photoFile);
          const photoUrl = await getDownloadURL(storageRef);
          await updateDoc(doc(db, 'users', uid), { photoUrl, updatedAt: serverTimestamp() });
        } catch {
          // Swallowed by design — see above.
        }
      }

      navigate('/enroll/choose-app');
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to create account');
      }
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepEmail
            ejemEmail={ejemEmail}
            onChange={setEjemEmail}
            onSubmit={handleSendCode}
            loading={loading}
            error={error}
            logoSrc="/logo.png"
            logoAlt="Sync"
          />
        );
      case 1:
        return (
          <StepVerify
            resendCooldownS={resendCooldownS}
            ejemEmail={ejemEmail}
            onVerify={async (code) => {
              const verifyFn = httpsCallable(functions, 'verifyCode');
              // enrollStudentIdentity requires an EJM-class code (mirrors
              // enrollBabysitter/enrollTutor, issue #322) — say so here too,
              // so a code minted through the any-domain parent callable
              // fails at this step instead of at the end of the wizard.
              await verifyFn({ email: ejemEmail, code, requireIdentityClass: 'ejm' });
              handleCodeVerified(code);
            }}
            onResend={async () => {
              const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
              await verifyEjmEmail({ email: ejemEmail, app: 'sit' });
            }}
            error={error}
          />
        );
      case 2:
        return (
          <StepPassword
            onSubmit={handlePasswordNext}
            consentVersion={CONSENT_VERSION}
            loading={loading}
            error={error}
          />
        );
      case 3:
        return (
          <StepBasicInfo onNext={handleBasicInfoNext} initial={basicInfo} ejemEmail={ejemEmail} />
        );
      case 4:
        return (
          <StepContactInfo onNext={handleContactInfoNext} initial={contactInfo} ejemEmail={ejemEmail} />
        );
      case 5:
        return (
          <StepAdditionalInfo onNext={handleAdditionalInfoNext} serverError={error} />
        );
      default:
        return null;
    }
  };

  // Wait for auth resolution before mounting the wizard — keeps the resume
  // redirect from racing a not-yet-known auth state (mirrors
  // BabysitterEnrollment/TutorEnrollment).
  if (authLoading) return null;

  return (
    <div>
      <TopNav
        title={t('unifiedEnrollment.studentTitle')}
        backTo={step === 0 ? '/enroll' : undefined}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
      />
      <StepIndicator totalSteps={TOTAL_STEPS} currentStep={step} />
      {renderStep()}
    </div>
  );
}
