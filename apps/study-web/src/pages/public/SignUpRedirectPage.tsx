import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sitSignUpUrl } from '@/utils/appSwitch';
import { Spinner } from '@ejm/shared-ui';

/**
 * `/signup` (issue #435 milestone, PR5): sync-study's own role question is
 * retired. sync-sit.com/enroll — hosted on apps/web — is now the ONE
 * cross-app entry point, showing all three app icons and running the common
 * student-identity flow before handing back into study's role-specific
 * continuation. This route forwards there cross-origin, carrying the
 * CURRENT language the same way `AppSwitchMenuItem`'s handoff does (i18n
 * caches are per-origin localStorage, so the target has no record of it yet).
 *
 * This is a plain, no-auth pre-signup redirect (unlike `/handoff`, which
 * carries an authenticated session) — a `window.location.assign`, not a
 * client-side `<Navigate>`, since the destination is a different origin.
 *
 * Direct role-specific continuation routes are UNCHANGED and still reachable
 * on this origin: `/enroll/tutor` (the classic tutor wizard, and the target
 * an already-authenticated sit babysitter's crossApp add-role flow resumes
 * into) and `/enroll/parent`. Only the role-QUESTION entry point moves.
 */
export function SignUpRedirectPage() {
  const { i18n } = useTranslation();

  useEffect(() => {
    window.location.assign(sitSignUpUrl(i18n.language));
  }, [i18n.language]);

  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}
