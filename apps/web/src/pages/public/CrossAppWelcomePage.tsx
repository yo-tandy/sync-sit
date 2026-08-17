import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { isTutor } from '@ejm/shared-core';
import { getSitRole } from '@ejm/sit-core';
import { enrollmentErrorReason } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { Button, Card, Spinner } from '@/components/ui';

// Same consent version the classic wizard passes to StepPassword.
const CONSENT_VERSION = '1.0';

/**
 * One-tap cross-app arrival for a study tutor with no sit role (issue #144,
 * owner call): their EJM identity was verified at first enrollment and their
 * login already works here, so the ONLY thing left to ask is what is
 * sit-specific. Continue enrolls via the crossApp callable (no email, no
 * code, no password) and hands over to the wizard's resume routing, which
 * lands on availability (classLevel/gender/contact were copied server-side).
 */
export function CrossAppWelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
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
  const role = getSitRole(userDoc);
  if (role) return <Navigate to={postLoginRouter(role, userDoc)} replace />;
  if (!isTutor(userDoc)) return <Navigate to="/signup" replace />;

  const handleContinue = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const enrollFn = httpsCallable(functions, 'enrollBabysitter');
      await enrollFn({ crossApp: true, consentVersion: CONSENT_VERSION });
      await refreshUserDoc();
      navigate('/enroll/babysitter');
    } catch (err: unknown) {
      if (enrollmentErrorReason(err) === 'profile-exists') {
        navigate('/babysitter');
        return;
      }
      setError(err instanceof Error ? err.message : t('common.error'));
      setSubmitting(false);
    }
  };

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
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}
        <Button onClick={handleContinue} disabled={submitting}>
          {submitting ? t('common.loading') : t('common.continue')}
        </Button>
      </Card>
    </div>
  );
}
