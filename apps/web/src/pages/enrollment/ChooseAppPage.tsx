import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { getEjemEmail } from '@ejm/shared-core';
import { getSitRole } from '@ejm/sit-core';
import {
  APP_NAME,
  BRAND_MARKS,
  useDocumentGround,
  enrollmentErrorReason,
  ageGateErrorCode,
  LanguageSelector,
} from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { STUDY_APP_URL } from '@/lib/appSwitch';
import { Spinner } from '@/components/ui';

// Same consent version the classic sit wizard passes to StepPassword.
const CONSENT_VERSION = '1.0';

type SwitchingApp = 'sit' | 'study' | null;

/**
 * "Choose your app" (issue #435 milestone, PR4, `/enroll/choose-app`): the
 * unified student flow's identity is done — EJM-verified, root fields on
 * file, no role profile yet — and this is where the user picks which app to
 * finish enrolling in. `do` is decorative only (platform-plan decision 20),
 * matching `UnifiedLandingPage`'s brand row.
 *
 * Sit is same-origin: `enrollBabysitter({crossApp: true})` (the exact
 * `CrossAppWelcomePage` precedent) copies the root fields server-side and
 * resumes `BabysitterEnrollment` straight at `StepPreferences` — nothing
 * left to ask, since the unified flow already collected classLevel/gender/
 * contact.
 *
 * Study is cross-origin: mint a handoff code (same mechanism
 * `AppSwitchBar`/`createAppHandoffCode` use) and hand off to study's
 * `/tutor/welcome-crossapp`, which calls `enrollTutor({crossApp: true})` and
 * resumes at subjects (the only thing study still needs).
 */
export function ChooseAppPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  useDocumentGround('admin');
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();
  const [switching, setSwitching] = useState<SwitchingApp>(null);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }
  if (!firebaseUser) return <Navigate to="/enroll/student" replace />;
  const role = getSitRole(userDoc);
  if (role) return <Navigate to={postLoginRouter(role, userDoc)} replace />;
  // No verified identity on file at all — this page only makes sense right
  // after the unified flow's account-creation step.
  if (!getEjemEmail(userDoc)) return <Navigate to="/enroll/student" replace />;

  // Known crossApp rejections map to the same translated copy the classic
  // wizard/CrossAppWelcomePage show (issue #159) — never on message strings.
  const translateEnrollError = (err: unknown): string => {
    if (enrollmentErrorReason(err) === 'role-exclusive') return t('signup.roleExclusiveBabysitter');
    const ageCode = ageGateErrorCode(err);
    if (ageCode === 'age/under-15') return t('enrollment.age.under15');
    if (ageCode === 'age/mismatch') return t('enrollment.age.mismatch');
    return t('welcomeCross.genericError');
  };

  const handleChooseSit = async () => {
    if (switching) return;
    setSwitching('sit');
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
      setSwitching(null);
    }
  };

  const handleChooseStudy = async () => {
    if (switching) return;
    setSwitching('study');
    setError(null);
    try {
      const mint = httpsCallable<Record<string, never>, { code: string }>(functions, 'createAppHandoffCode');
      const res = await mint({});
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      window.location.assign(
        `${STUDY_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}`,
      );
      // Stay "switching": the browser is navigating away.
    } catch {
      setError(t('welcomeCross.genericError'));
      setSwitching(null);
    }
  };

  return (
    <div className="bg-ground-admin flex min-h-[100dvh] flex-col px-6 py-4">
      <div className="flex shrink-0 justify-end">
        <LanguageSelector />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-8">
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-950">
          {t('unifiedEnrollment.chooseAppTitle')}
        </h1>
        <p className="mx-auto mb-8 max-w-[320px] text-center text-sm text-gray-500">
          {t('unifiedEnrollment.chooseAppSubtitle')}
        </p>

        <button
          type="button"
          onClick={handleChooseSit}
          disabled={switching !== null}
          className="mb-4 flex items-center gap-4 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50 active:bg-brand-50 disabled:opacity-60"
        >
          <img src={BRAND_MARKS.sit.md} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-contain" />
          <div className="flex-1">
            <p className="text-base font-semibold text-gray-950">{APP_NAME.sit}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{t('unifiedEnrollment.chooseSitDesc')}</p>
          </div>
          {switching === 'sit' && <Spinner className="h-5 w-5 shrink-0 text-brand-600" />}
        </button>

        <button
          type="button"
          onClick={handleChooseStudy}
          disabled={switching !== null}
          className="mb-4 flex items-center gap-4 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50 active:bg-brand-50 disabled:opacity-60"
        >
          <img src={BRAND_MARKS.study.md} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-contain" />
          <div className="flex-1">
            <p className="text-base font-semibold text-gray-950">{APP_NAME.study}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{t('unifiedEnrollment.chooseStudyDesc')}</p>
          </div>
          {switching === 'study' && <Spinner className="h-5 w-5 shrink-0 text-brand-600" />}
        </button>

        <div className="mb-4 flex items-center gap-4 rounded-xl border-[1.5px] border-gray-100 bg-gray-50 p-5 opacity-60">
          <img src={BRAND_MARKS.do.md} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-contain grayscale" />
          <div className="flex-1">
            <p className="text-base font-semibold text-gray-500">{APP_NAME.do}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">{t('unifiedEnrollment.chooseDoDesc')}</p>
          </div>
          <span className="rounded-pill bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
            {t('unifiedEnrollment.comingSoon')}
          </span>
        </div>

        {error && <p className="mt-2 text-center text-sm text-error-600">{error}</p>}
      </div>
    </div>
  );
}
