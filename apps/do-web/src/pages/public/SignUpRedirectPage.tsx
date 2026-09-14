import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sitSignUpUrl } from '@/utils/appSwitch';
import { Spinner } from '@ejm/shared-ui';

/**
 * `/signup` (issue #435 milestone, PR5): sync-do's own role question is
 * retired. sync-sit.com/enroll — hosted on apps/web — is now the ONE
 * cross-app entry point, showing all three app icons and running the common
 * student-identity flow before handing back into the right app's
 * role-specific continuation. This route forwards there cross-origin,
 * carrying the CURRENT language the same way `AppSwitchMenuItem`'s handoff
 * does (i18n caches are per-origin localStorage, so the target has no
 * record of it yet).
 *
 * This is a plain, no-auth pre-signup redirect (unlike a handoff, which
 * carries an authenticated session) — a `window.location.assign`, not a
 * client-side `<Navigate>`, since the destination is a different origin.
 *
 * `/enroll/doer` stays reachable directly on this origin, UNCHANGED — it is
 * sync-do's only functional enrollment (decision 20 keeps do decorative,
 * not linked, on the unified landing page itself), and it's also where an
 * already-authenticated foreign user's crossApp add-doer-role flow resumes.
 * See this PR's "Open questions": blind-redirecting /signup means that flow
 * can no longer be reached FROM /signup directly (only from /enroll/doer's
 * own URL) — a known, deliberate trade-off per the milestone plan, kept to
 * a one-line revert if the owner decides otherwise before do launches.
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
