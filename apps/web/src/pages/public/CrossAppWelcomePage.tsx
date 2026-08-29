import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { isTutor } from '@ejm/shared-core';
import { getSitRole } from '@ejm/sit-core';
import { enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { STUDY_APP_URL } from '@/lib/appSwitch';
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

  // Known crossApp rejections map to the same translated copy the classic
  // wizard shows (issue #159), keyed on the machine-readable details — never
  // on message strings. The age branches are defensive symmetry with study:
  // enrollBabysitter has no server age gate today, but the codes are shared.
  // Anything unrecognized gets a translated generic message (raw server text
  // must never render); the fallback-wizard link stays as the escape hatch.
  const translateEnrollError = (err: unknown): string => {
    if (enrollmentErrorReason(err) === 'role-exclusive') return t('signup.roleExclusiveBabysitter');
    const ageCode = ageGateErrorCode(err);
    if (ageCode === 'age/under-15') return t('enrollment.age.under15');
    if (ageCode === 'age/mismatch') return t('enrollment.age.mismatch');
    return t('welcomeCross.genericError');
  };

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
      setError(translateEnrollError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="px-5 pt-8 pb-8">
      {/* App branding: the user just crossed apps — say WHERE they landed. */}
      <div className="mb-6 flex flex-col items-center gap-2">
        {/* rounded-xl, not rounded-2xl (#395 review round 2): the Recess pass
            raised --radius-2xl to 1.75rem, which is EXACTLY half of h-14/w-14
            (3.5rem) at every root font size — so 2xl would render this mark as
            a perfect circle and clip the squircle artwork's corners. The other
            14 rounded-2xl sites are h-20/h-24/h-32 and are unaffected. */}
          <img src="/logo.png" alt="Sync/Sit" className="h-14 w-14 rounded-xl" />
        <p className="text-lg font-bold text-gray-900">Sync/Sit</p>
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
        {error && (
          <>
            <p className="mb-2 text-sm text-brand-600">{error}</p>
            {/* Escape hatch: the classic wizard collects whatever the
                one-tap path could not derive. */}
            <p className="mb-4 text-sm">
              <Link to="/enroll/babysitter" className="font-medium text-brand-600">
                {t('welcomeCross.fallbackWizard')}
              </Link>
            </p>
          </>
        )}
        <Button onClick={handleContinue} disabled={submitting}>
          {submitting ? t('common.loading') : t('common.continue')}
        </Button>
        {/* Continuing accepts the terms — so there must be a way NOT to.
            The only sensible retreat for a role-less arrival is the app
            they came from. */}
        <a
          href={STUDY_APP_URL}
          className="mt-3 block text-center text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          {t('welcomeCross.backToOrigin')}
        </a>
      </Card>
    </div>
  );
}
