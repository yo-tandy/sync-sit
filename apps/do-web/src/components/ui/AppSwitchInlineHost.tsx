import { useLocation, useNavigate } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchInline } from '@ejm/shared-ui';
import doSm from '@ejm/shared-ui/brand-marks/sync-do-48.png';
import doMd from '@ejm/shared-ui/brand-marks/sync-do-96.png';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL, STUDY_APP_URL } from '@/utils/appSwitch';

// Imported directly (#422) -- see AppSwitchBarHost's own copy of these
// constants for the rationale. do-web is the exception to "ships only its
// own marks": it offers BOTH siblings (decision 20 gates linking TO do, not
// FROM it), so all three marks legitimately belong in this graph.
const DO_MARK = { sm: doSm, md: doMd };
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/do's binding of the shared desktop app switch (#417, plan Q9) --
 * mirrors `AppSwitchBarHost`'s asymmetric shape (both siblings offered, NO
 * account entry -- do-web ships no account page by design, plan §18.3),
 * rendering `AppSwitchInline` instead of `AppSwitchBar`. Its own host file
 * rather than a shared hook, matching this codebase's convention of
 * per-portal host duplication.
 */
export function AppSwitchInlineHost({
  /** This portal's dashboard route -- where the current-app entry goes. */
  homeHref,
  tone,
}: {
  homeHref: string;
  /** 'onBrand' from a portal's own bg-brand-600 strip; omitted (light) elsewhere. */
  tone?: 'light' | 'onBrand';
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

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
      current="do"
      currentMark={DO_MARK}
      siblings={[
        { app: 'sit', url: SIT_APP_URL, mark: SIT_MARK },
        { app: 'study', url: STUDY_APP_URL, mark: STUDY_MARK },
      ]}
      mintHandoffCode={mintHandoffCode}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
      tone={tone}
    />
  );
}
