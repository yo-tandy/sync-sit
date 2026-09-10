import { useLocation, useNavigate } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchBar } from '@ejm/shared-ui';
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
 * - It renders NO account tab. do-web ships no account page by design
 *   (plan §18.3): the shared hub owns identity, contact, language,
 *   notifications and the rest, and do contributes only a doer-settings
 *   screen reached from a row in that hub. Until the hub exists (#367) there
 *   is no account route here to point at, and a tab leading nowhere is worse
 *   than an absent one. Passing accountHref is the whole change when #367
 *   lands.
 *
 * Because there is no account tab, the current-app tab is do's ONLY in-app
 * control on the bar -- which is also the only way a failed-switch message
 * clears here without a route change or a retry.
 */
export function AppSwitchBarHost({
  /** This portal's dashboard route -- where the current-app tab goes. */
  homeHref,
}: {
  homeHref: string;
}) {
  // The bar is persistent -- it lives in the layout, outside <Outlet /> -- so
  // it cannot see a route change on its own and needs the current path to
  // retire a failed-switch message. do has no account tab to mark active, but
  // the message lifetime applies here exactly as it does in sit and study.
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
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
    />
  );
}
