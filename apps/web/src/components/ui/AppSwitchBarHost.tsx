import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchBar } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { STUDY_APP_URL } from '@/lib/appSwitch';

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
      current="sit"
      siblings={[{ app: 'study', url: STUDY_APP_URL }]}
      mintHandoffCode={mintHandoffCode}
      accountHref={accountHref}
      accountActive={pathname === accountHref}
      onNavigateAccount={(href) => void navigate(href)}
    />
  );
}
