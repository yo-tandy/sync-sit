import { useLocation, useNavigate } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { ACCOUNT_HUB_PATH, AppSwitchBar } from '@ejm/shared-ui';
import doSm from '@ejm/shared-ui/brand-marks/sync-do-48.png';
import doMd from '@ejm/shared-ui/brand-marks/sync-do-96.png';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL, STUDY_APP_URL } from '@/utils/appSwitch';

// Imported directly (#422). do-web is the exception to "ships only its own
// marks": it offers BOTH siblings (decision 20 gates linking TO do, not FROM
// it), so all three marks legitimately belong in this graph.
const DO_MARK = { sm: doSm, md: doMd };
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/do's binding of the shared app-switch bar (#365, plan §18.2).
 *
 * do-web's bar is the asymmetric one, and both halves of that are deliberate:
 *
 * - It offers BOTH siblings. Decision 20 gates sit and study linking TO
 *   sync-do, not sync-do linking out, so this direction needs no approval.
 * - Its account tab LEAVES the app. do-web ships no account page by design
 *   (plan §18.3): the suite's one account hub lives on sync-sit, so the tab
 *   hands off there (`next=/account`) like the sibling tabs do.
 *
 * Every tab but the current-app one leaves the origin, so that tab is do's
 * ONLY in-app control on the bar -- which is also the only way a
 * failed-switch message clears here without a route change or a retry.
 */
export function AppSwitchBarHost({
  /** This portal's dashboard route -- where the current-app tab goes. */
  homeHref,
}: {
  homeHref: string;
}) {
  // The bar is persistent -- it lives in the layout, outside <Outlet /> -- so
  // it cannot see a route change on its own and needs the current path to
  // retire a failed-switch message. do's account tab is a handoff, never
  // active, but the message lifetime applies here exactly as in sit and study.
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
    <AppSwitchBar
      current="do"
      currentMark={DO_MARK}
      siblings={[
        { app: 'sit', url: SIT_APP_URL, mark: SIT_MARK },
        { app: 'study', url: STUDY_APP_URL, mark: STUDY_MARK },
      ]}
      mintHandoffCode={mintHandoffCode}
      // do ships no account page: the tab hands off to the suite's one
      // account hub on sync-sit.
      account={{ href: ACCOUNT_HUB_PATH, handoffUrl: SIT_APP_URL }}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
    />
  );
}
