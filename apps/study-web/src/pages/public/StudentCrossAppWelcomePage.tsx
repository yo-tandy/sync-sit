import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { CONSENT_VERSION, getEjemEmail, isBabysitter } from '@ejm/shared-core';
import { getStudyRole, type SubjectOffering } from '@ejm/study-core';
import { ensureTutorProfileLoaded } from '@/lib/ensureTutorProfileLoaded';
import { Button, Card, Spinner, enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { crossAppTutorGaps, hasCrossAppTutorGaps, postLoginRouter } from '@/utils/postLoginRouter';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { StepSubjects } from '@/pages/enrollment/tutor/StepSubjects';

/**
 * `/tutor/welcome-crossapp` (issue #435 milestone, PR4) — a generic
 * "verified EJM identity, no study role yet" landing page. The unified
 * flow's root-only identity (created by apps/web's `enrollStudentIdentity`,
 * no role profile at all) is the flow that ships it and the most common
 * arrival, via the cross-origin handoff after picking "study" on
 * `/enroll/choose-app` — but the gate below is not scoped to that shape:
 * ANY account with a verified root `ejemEmail` and no study role qualifies,
 * a sync-do doer included (decision 20 forbids sit/study reachability INTO
 * do, not the reverse — a doer is as entitled to add tutoring as any other
 * verified student, and `enrollTutor`'s crossApp precondition already allows
 * it server-side).
 *
 * Deliberately a SEPARATE page from `CrossAppWelcomePage` (`/welcome-study`),
 * which is gated on `isBabysitter` — the existing "a sit babysitter adds a
 * tutor role" precedent. A babysitter fails THIS page's gate (handled by
 * `/welcome-study` instead); this page's gate is the inverse (no role, NOT a
 * babysitter, but a verified root identity is on file — whatever produced
 * it). Both pages otherwise share the same mechanism —
 * `crossAppTutorGaps`/`hasCrossAppTutorGaps` render only the fields the doc
 * actually lacks (none, in the ordinary unified-flow case: StepBasicInfo/
 * StepContactInfo already collected everything but subjects; a doer-only doc
 * may have real gaps, e.g. no DOB) before `enrollTutor({crossApp: true,
 * subjects, ...})`, which resolves classLevel/gender/contact off the
 * caller's OWN root doc — exactly the same "canonical root, resolved
 * server-side" pattern PR1 established.
 */
export function StudentCrossAppWelcomePage() {
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
  // A sit babysitter belongs on the OTHER crossApp welcome page
  // (`/welcome-study`); a doc with no verified identity at all (no
  // ejemEmail anywhere) is a genuinely fresh visitor. Any OTHER
  // server-verified EJM identity with no study role belongs here — the
  // unified flow's root-only shape is the common case, but a sync-do
  // doer-only account (verified via enrollDoer, no babysitter/tutor
  // profile) qualifies identically; see the module doc comment.
  if (isBabysitter(userDoc) || !getEjemEmail(userDoc)) return <Navigate to="/signup" replace />;

  const gaps = crossAppTutorGaps(userDoc);
  const needsGaps = hasCrossAppTutorGaps(gaps);

  // Known crossApp rejections map to the same translated copy the classic
  // wizard shows (issue #159), keyed on the machine-readable details — never
  // on message strings.
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
      // Both reads are swallowed (enrollment has already succeeded either
      // way) with one retry, mirroring the sit-side welcome page and
      // TutorEnrollment's identical pattern.
      if (!(await ensureTutorProfileLoaded(refreshUserDoc))) {
        setError(t('enrollment.crossApp.profileLoadError'));
        setSubmitting(false);
        return;
      }
      navigate('/tutor');
    } catch (err: unknown) {
      if (enrollmentErrorReason(err) === 'profile-exists') {
        if (await ensureTutorProfileLoaded(refreshUserDoc)) {
          navigate('/tutor');
        } else {
          setError(t('enrollment.crossApp.profileLoadError'));
          setSubmitting(false);
        }
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
          // Escape hatch: whatever the server rejected, the classic wizard
          // can collect it — never strand the user on this one-tap path.
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
      <div className="mb-6 flex flex-col items-center gap-2">
        <img src="/logo.png" alt="Sync/Study" className="h-14 w-14 rounded-xl" />
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
        {/* needsGaps is defensive (the unified flow always fills these) —
            if it's ever true, StepSubjects's own supplement path has no
            equivalent here, so fall back to the classic wizard rather than
            silently submitting an incomplete enrollment. */}
        {needsGaps ? (
          <p className="mb-4 text-sm">
            <Link to="/enroll/tutor" className="font-medium text-brand-600">
              {t('welcomeCross.fallbackWizard')}
            </Link>
          </p>
        ) : (
          <Button onClick={() => setPhase('subjects')}>{t('common.continue')}</Button>
        )}
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
