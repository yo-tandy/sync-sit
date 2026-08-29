import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchBar } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { SIT_APP_URL } from '@/utils/appSwitch';

/**
 * sync/study's binding of the shared app-switch bar (#365, plan §18.2).
 *
 * Mirrors apps/web's host: the bar is app-agnostic, this supplies study's
 * callable, its siblings, and the account path for the current role.
 *
 * SIBLINGS DELIBERATELY OMITS sync/do, for the same reason as sit's host:
 * decision 20 gates sync-do's reachability and #304 is the flip. Adding one
 * entry here is the whole change.
 */
export function AppSwitchBarHost({ accountHref }: { accountHref: string }) {
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
      siblings={[{ app: 'sit', url: SIT_APP_URL }]}
      mintHandoffCode={mintHandoffCode}
      accountHref={accountHref}
      accountActive={pathname === accountHref}
      onNavigateAccount={(href) => void navigate(href)}
    />
  );
}
