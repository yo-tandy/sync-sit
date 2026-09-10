import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchBar } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { STUDY_APP_URL } from '@/lib/appSwitch';

// Imported directly, not through a shared-ui lookup (#422): sit's dist then
// holds only its own mark and study's -- sync-do's never enters this graph.
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/sit's binding of the shared app-switch bar (#365, plan §18.2).
 *
 * The bar itself is app-agnostic; this supplies the three things it cannot
 * know: sit's Firebase callable, which siblings sit offers, and where "my
 * account" lives for the current role.
 *
 * SIBLINGS DELIBERATELY OMITS sync/do. Decision 20 gates sync-do's
 * reachability from sit and study, and #304 is the flip. Adding it here is
 * the whole change when that is approved -- which is why the gate lives at
 * this call site rather than inside the shared component.
 */
export function AppSwitchBarHost({
  accountHref,
  homeHref,
}: {
  accountHref: string;
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
      current="sit"
      currentMark={SIT_MARK}
      siblings={[{ app: 'study', url: STUDY_APP_URL, mark: STUDY_MARK }]}
      mintHandoffCode={mintHandoffCode}
      account={{ href: accountHref, onNavigate: (href) => void navigate(href) }}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
    />
  );
}
