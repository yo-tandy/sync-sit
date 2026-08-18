import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { isBabysitter } from '@ejm/shared-core';
import { getStudyRole, type SubjectOffering } from '@ejm/study-core';
import { Button, Card, Spinner, enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { StepSubjects } from '@/pages/enrollment/tutor/StepSubjects';

// Same consent version the classic wizard passes to StepPassword.
const CONSENT_VERSION = '2025-12-01';

/**
 * One-tap cross-app arrival for a sit babysitter with no study role (issue
 * #144, owner call): their EJM identity was verified at first enrollment and
 * their login already works here, so the ONLY thing left to collect is what
 * is study-specific — subjects. Continue reveals StepSubjects; submitting
 * enrolls via the crossApp callable (no email, no code, no password, no
 * identity/profile fields — classLevel/gender/contact are copied
 * server-side from the babysitter profile).
 */
export function CrossAppWelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
  const [phase, setPhase] = useState<'welcome' | 'subjects'>('welcome');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }
  if (!firebaseUser) return <Navigate to="/login" replace />;
  const role = getStudyRole(userDoc);
  if (role) return <Navigate to={postLoginRouter(role, userDoc)} replace />;
  if (!isBabysitter(userDoc)) return <Navigate to="/signup" replace />;

  // Known crossApp rejections map to the same translated copy the classic
  // wizard shows (issue #159), keyed on the machine-readable details — never
  // on message strings. Anything unrecognized gets a translated generic
  // message (raw server text must never render); the fallback-wizard link
  // below stays as the escape hatch.
  const translateEnrollError = (err: unknown): string => {
    if (enrollmentErrorReason(err) === 'role-exclusive') return t('signup.roleExclusiveTutor');
    const ageCode = ageGateErrorCode(err);
    if (ageCode === 'age/under-15') return t('enrollment.age.under15');
    if (ageCode === 'age/mismatch') return t('enrollment.age.mismatch');
    return t('welcomeCross.genericError');
  };

  const handleSubjectsNext = async (subjects: SubjectOffering[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const enrollFn = httpsCallable(functions, 'enrollTutor');
      await enrollFn({ crossApp: true, subjects, consentVersion: CONSENT_VERSION });
      await refreshUserDoc();
      navigate('/enroll/tutor/success', { state: { firstName: userDoc?.firstName } });
    } catch (err: unknown) {
      if (enrollmentErrorReason(err) === 'profile-exists') {
        navigate('/tutor');
        return;
      }
      setError(translateEnrollError(err));
      setSubmitting(false);
    }
  };

  if (phase === 'subjects') {
    return (
      <>
        <StepSubjects onNext={handleSubjectsNext} loading={submitting} error={error} />
        {error && (
          // Escape hatch: whatever the server rejected (a stale/incomplete
          // sit profile the routing gate missed), the classic wizard can
          // collect it — never strand the user on this one-tap path.
          <p className="px-6 pb-6 text-sm">
            <Link to="/enroll/tutor" className="font-medium text-brand-600">
              {t('welcomeCross.fallbackWizard')}
            </Link>
          </p>
        )}
      </>
    );
  }

  return (
    <div className="px-5 pt-8 pb-8">
      {/* App branding: the user just crossed apps — say WHERE they landed. */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <img src="/logo.png" alt="Sync/Study" className="h-14 w-14 rounded-2xl" />
        <p className="text-lg font-bold text-gray-900">Sync/Study</p>
      </div>
      <Card>
        <h2 className="mb-2 text-lg font-bold text-gray-900">
          {t('welcomeCross.greeting', { name: userDoc?.firstName })}
        </h2>
        <p className="mb-4 text-sm text-gray-600">{t('welcomeCross.body')}</p>
        <p className="mb-6 text-xs text-gray-500">
          {t('welcomeCross.consentPrefix')}{' '}
          <Link to="/terms" target="_blank" className="text-brand-600 hover:underline">
            {t('enrollment.termsOfService')}
          </Link>
          {' '}{t('enrollment.consentAnd')}{' '}
          <Link to="/privacy" target="_blank" className="text-brand-600 hover:underline">
            {t('enrollment.privacyPolicy')}
          </Link>
          .
        </p>
        <Button onClick={() => setPhase('subjects')}>{t('common.continue')}</Button>
        {/* Continuing accepts the terms — so there must be a way NOT to.
            The only sensible retreat for a role-less arrival is the app
            they came from. */}
        <a
          href={SIT_APP_URL}
          className="mt-3 block text-center text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          {t('welcomeCross.backToOrigin')}
        </a>
      </Card>
    </div>
  );
}
