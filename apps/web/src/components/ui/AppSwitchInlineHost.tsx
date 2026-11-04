import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchInline } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { STUDY_APP_URL } from '@/lib/appSwitch';

// Imported directly, not through a shared-ui lookup (#422) -- see
// AppSwitchBarHost's own copy of this constant for the rationale.
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/sit's binding of the shared desktop app switch (#417, plan Q9) --
 * the top-bar/sidebar-head counterpart to `AppSwitchBarHost`. Same current
 * app, same sibling gate (decision 20 -- sync-do stays out of `siblings`
 * until #304), same handoff callable. Deliberately its OWN host file rather
 * than a shared hook: this codebase's convention is per-portal host
 * duplication (see FamilyAppBar's "chrome intentionally duplicated per
 * portal" docstring) — a ~20-line host is cheap, and every other
 * app/bar/bottom-vs-inline pairing in this repo already duplicates this
 * shape rather than sharing it through an abstraction.
 *
 * `accountHref` is OPTIONAL here, unlike `AppSwitchBarHost`'s required prop
 * -- admin is the one caller with no account entry (AdminLayout's sidebar
 * head): admin never renders `AppSwitchBarHost` either, and its `AppBar`
 * burger has never offered a "My account" row (its primary nav list is
 * empty), so there is no accountHref for admin to have forgotten.
 */
export function AppSwitchInlineHost({
  accountHref,
  homeHref,
  tone,
}: {
  accountHref?: string;
  /** This portal's dashboard route -- where the current-app entry goes. */
  homeHref: string;
  /** 'onBrand' from AppBar's own bg-brand-600 strip; omitted (light) from the account hub header and the admin sidebar head, both white grounds. */
  tone?: 'light' | 'onBrand';
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const mintHandoffCode = async () => {
    const mint = httpsCallable<Record<string, never>, { code: string }>(
      functions,
      'createAppHandoffCode',
    );
    const res = await mint({});
    return res.data.code;
  };

  return (
    <AppSwitchInline
      current="sit"
      currentMark={SIT_MARK}
      siblings={[{ app: 'study', url: STUDY_APP_URL, mark: STUDY_MARK }]}
      mintHandoffCode={mintHandoffCode}
      account={accountHref ? { href: accountHref, onNavigate: (href) => void navigate(href) } : undefined}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
      tone={tone}
    />
  );
}
