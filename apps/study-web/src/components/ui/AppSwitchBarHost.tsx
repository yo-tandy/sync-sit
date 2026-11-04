import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { ACCOUNT_HUB_PATH, AppSwitchBar } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL } from '@/utils/appSwitch';

// Imported directly, not through a shared-ui lookup (#422): study's dist
// then holds only its own mark and sit's -- sync-do's never enters this
// graph.
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/study's binding of the shared app-switch bar (#365, plan §18.2).
 *
 * Mirrors apps/web's host: the bar is app-agnostic, this supplies study's
 * callable and its siblings. The account tab hands off to the suite's one
 * account hub on sync-sit.
 *
 * SIBLINGS DELIBERATELY OMITS sync/do, for the same reason as sit's host:
 * decision 20 gates sync-do's reachability and #304 is the flip. Adding one
 * entry here is the whole change.
 */
export function AppSwitchBarHost({
  homeHref,
}: {
  /** This portal's dashboard route -- where the current-app tab goes. */
  homeHref: string;
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
    <AppSwitchBar
      current="study"
      currentMark={STUDY_MARK}
      siblings={[{ app: 'sit', url: SIT_APP_URL, mark: SIT_MARK }]}
      mintHandoffCode={mintHandoffCode}
      // The ONE account hub lives on sync-sit: hand off there, never to a
      // study route (study's own profile pages stay in its burger menu).
      account={{ href: ACCOUNT_HUB_PATH, handoffUrl: SIT_APP_URL }}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
    />
  );
}
