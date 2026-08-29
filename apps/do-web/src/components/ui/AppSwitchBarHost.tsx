import { useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchBar } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { SIT_APP_URL, STUDY_APP_URL } from '@/utils/appSwitch';

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
 */
export function AppSwitchBarHost() {
  // The bar is persistent -- it lives in the layout, outside <Outlet /> -- so
  // it cannot see a route change on its own and needs the current path to
  // retire a failed-switch message. do has no account tab to mark active, but
  // the message lifetime applies here exactly as it does in sit and study.
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
      current="do"
      siblings={[
        { app: 'sit', url: SIT_APP_URL },
        { app: 'study', url: STUDY_APP_URL },
      ]}
      mintHandoffCode={mintHandoffCode}
      pathname={pathname}
    />
  );
}
