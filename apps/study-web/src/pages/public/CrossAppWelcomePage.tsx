import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { isBabysitter } from '@ejm/shared-core';
import { getStudyRole, type SubjectOffering } from '@ejm/study-core';
import { Button, Card, Spinner, enrollmentErrorReason } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/utils/postLoginRouter';
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
      setError(err instanceof Error ? err.message : t('common.error'));
      setSubmitting(false);
    }
  };

  if (phase === 'subjects') {
    return <StepSubjects onNext={handleSubjectsNext} loading={submitting} error={error} />;
  }

  return (
    <div className="px-5 pt-8 pb-8">
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
      </Card>
    </div>
  );
}
