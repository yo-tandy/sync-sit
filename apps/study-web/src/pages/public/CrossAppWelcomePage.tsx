import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { isBabysitter } from '@ejm/shared-core';
import { getStudyRole, getTutorProfile, type SubjectOffering } from '@ejm/study-core';
import { Button, Card, Input, Select, Spinner, enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { crossAppTutorGaps, hasCrossAppTutorGaps, postLoginRouter } from '@/utils/postLoginRouter';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { StepSubjects } from '@/pages/enrollment/tutor/StepSubjects';
import { CLASS_LEVELS_TUTOR, GENDER_OPTIONS, getAge } from '@/pages/enrollment/tutor/profileFields';

// Same consent version the classic wizard passes to StepPassword.
const CONSENT_VERSION = '2025-12-01';

/**
 * One-tap cross-app arrival for a sit babysitter with no study role (issue
 * #144, owner call): their EJM identity was verified at first enrollment and
 * their login already works here, so all that is left to collect is what is
 * study-specific — subjects — plus whatever the sit profile happens to lack
 * (issue #203: contact is skippable in sit; older docs miss a DOB or
 * classLevel). Continue reveals a details step for exactly the missing
 * fields (skipped entirely when nothing is missing), then StepSubjects;
 * submitting enrolls via the crossApp callable (no email, no code, no
 * password) — every field the babysitter profile DOES carry is copied
 * server-side and always wins over the supplement.
 */
export function CrossAppWelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
  const [phase, setPhase] = useState<'welcome' | 'details' | 'subjects'>('welcome');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Gap-filling details (issue #203) — only the fields the sit doc lacks are
  // rendered; the rest of this state simply never gets used.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

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

  const gaps = crossAppTutorGaps(userDoc);
  const needsDetails = hasCrossAppTutorGaps(gaps);

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
      // Supplement: ONLY the fields the sit doc lacks, only when entered.
      // The server merges the stored profile copy over it anyway (stored
      // wins) — this keeps the wire payload honest and the no-gap case
      // byte-identical to the original subjects-only call.
      const supplement: Record<string, string> = {};
      if (gaps.firstName && firstName.trim()) supplement.firstName = firstName.trim();
      if (gaps.lastName && lastName.trim()) supplement.lastName = lastName.trim();
      if (gaps.dateOfBirth && dateOfBirth) supplement.dateOfBirth = dateOfBirth;
      if (gaps.classLevel && classLevel) supplement.classLevel = classLevel;
      if (gaps.gender && gender) supplement.gender = gender;
      if (gaps.contact && contactEmail.trim()) supplement.contactEmail = contactEmail.trim();
      if (gaps.contact && contactPhone.trim()) supplement.contactPhone = contactPhone.trim();
      await enrollFn({
        crossApp: true,
        subjects,
        consentVersion: CONSENT_VERSION,
        ...(Object.keys(supplement).length > 0 ? { enrollment: supplement } : {}),
      });
      await refreshUserDoc();
      // refreshUserDoc is a single getDoc that silently no-ops on a cache
      // miss; one retry (short backoff -- an immediate identical read would
      // return the same miss) keeps a blip from bouncing this authenticated
      // user off AuthGuard to /signup (PR #257 rounds 2-3). If BOTH reads
      // miss, do not navigate blind into the guard: surface an error and
      // leave the button usable -- a resubmit hits profile-exists, whose
      // handler runs the same doc-aware recovery (round 4).
      if (!getTutorProfile(useAuthStore.getState().userDoc)) {
        await new Promise((r) => setTimeout(r, 400));
        await refreshUserDoc().catch(() => {});
      }
      if (!getTutorProfile(useAuthStore.getState().userDoc)) {
        setError(t('enrollment.crossApp.profileLoadError'));
        setSubmitting(false);
        return;
      }
      // Straight to the dashboard (issue #242, parity Q5=b).
      navigate('/tutor');
    } catch (err: unknown) {
      if (enrollmentErrorReason(err) === 'profile-exists') {
        // The profile exists server-side; make sure the STORE can prove it
        // before entering the guard (round 4 -- this handler used to
        // navigate unconditionally, the same blind-navigate class).
        await refreshUserDoc().catch(() => {});
        if (!getTutorProfile(useAuthStore.getState().userDoc)) {
          await new Promise((r) => setTimeout(r, 400));
          await refreshUserDoc().catch(() => {});
        }
        if (getTutorProfile(useAuthStore.getState().userDoc)) {
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

  if (phase === 'details') {
    // Client-side gates mirror the classic StepProfile so a rejection cannot
    // strand the user on the subjects step: entered-DOB 15-18 window and the
    // server's zod .email() strictness (the native input accepts 'x@y').
    const age = getAge(dateOfBirth);
    const ageValid = age !== null && age >= 15 && age < 19;
    const showAgeError = !!dateOfBirth && !ageValid;
    const emailFormatOk =
      !contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim());
    const hasContact = !!(contactEmail.trim() || contactPhone.trim());
    const detailsValid =
      (!gaps.firstName || !!firstName.trim()) &&
      (!gaps.lastName || !!lastName.trim()) &&
      (!gaps.dateOfBirth || (!!dateOfBirth && ageValid)) &&
      (!gaps.classLevel || !!classLevel) &&
      (!gaps.contact || (hasContact && emailFormatOk));

    return (
      <div className="px-5 pt-8 pb-8">
        <Card>
          <h2 className="mb-2 text-lg font-bold text-gray-900">{t('welcomeCross.detailsTitle')}</h2>
          <p className="mb-5 text-sm text-gray-600">{t('welcomeCross.detailsBody')}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!detailsValid) return;
              setPhase('subjects');
            }}
          >
            {(gaps.firstName || gaps.lastName) && (
              <div className="flex gap-3">
                {gaps.firstName && (
                  <div className="flex-1">
                    <Input
                      label={t('enrollment.firstName')}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                )}
                {gaps.lastName && (
                  <div className="flex-1">
                    <Input
                      label={t('enrollment.lastName')}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>
            )}

            {(gaps.dateOfBirth || gaps.classLevel) && (
              <div className="grid grid-cols-2 gap-3">
                {gaps.dateOfBirth && (
                  <div className="min-w-0">
                    <Input
                      label={t('enrollment.dateOfBirth')}
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      error={showAgeError ? t('enrollment.ageError') : undefined}
                      required
                    />
                  </div>
                )}
                {gaps.classLevel && (
                  <div className="min-w-0">
                    <Select
                      label={t('enrollment.classLabel')}
                      value={classLevel}
                      onChange={(e) => setClassLevel(e.target.value)}
                      placeholder={t('enrollment.selectClass')}
                      options={CLASS_LEVELS_TUTOR.map((level) => ({ value: level, label: level }))}
                      required
                    />
                  </div>
                )}
              </div>
            )}

            {gaps.gender && (
              <div className="mb-5">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t('enrollment.gender')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGender(gender === opt.value ? undefined : opt.value)}
                      className={`flex-1 rounded-lg border-[1.5px] px-2 py-2 text-sm font-medium transition-colors ${
                        gender === opt.value
                          ? 'border-brand-600 bg-brand-50 text-brand-600'
                          : 'border-gray-300 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {gaps.contact && (
              <>
                <p className="mb-1 text-sm font-semibold text-gray-700">
                  {t('enrollment.contactSection')}
                </p>
                <p className="mb-3 text-xs text-gray-500">{t('enrollment.contactHint')}</p>
                <Input
                  label={t('enrollment.contactEmail')}
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  error={
                    contactEmail.trim() && !emailFormatOk
                      ? t('enrollment.contactEmailInvalid')
                      : undefined
                  }
                />
                <Input
                  label={t('enrollment.contactPhone')}
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </>
            )}

            <Button type="submit" disabled={!detailsValid}>
              {t('common.continue')}
            </Button>
          </form>
        </Card>
      </div>
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
        <Button onClick={() => setPhase(needsDetails ? 'details' : 'subjects')}>
          {t('common.continue')}
        </Button>
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
