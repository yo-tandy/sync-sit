import { useNavigate, useLocation } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { AppSwitchInline } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL } from '@/utils/appSwitch';

// Imported directly, not through a shared-ui lookup (#422) -- see
// AppSwitchBarHost's own copy of this constant for the rationale.
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

/**
 * sync/study's binding of the shared desktop app switch (#417, plan Q9) --
 * mirrors `AppSwitchBarHost` (same current app, same sibling gate --
 * decision 20 keeps sync-do out of `siblings` until #304 -- same handoff
 * callable), rendering `AppSwitchInline` instead of `AppSwitchBar`. Its own
 * host file rather than a shared hook, matching this codebase's convention
 * of per-portal host duplication.
 */
export function AppSwitchInlineHost({
  accountHref,
  homeHref,
  tone,
}: {
  accountHref: string;
  /** This portal's dashboard route -- where the current-app entry goes. */
  homeHref: string;
  /** 'onBrand' from a portal's own bg-brand-600 strip; omitted (light) elsewhere. */
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
      current="study"
      currentMark={STUDY_MARK}
      siblings={[{ app: 'sit', url: SIT_APP_URL, mark: SIT_MARK }]}
      mintHandoffCode={mintHandoffCode}
      account={{ href: accountHref, onNavigate: (href) => void navigate(href) }}
      pathname={pathname}
      home={{ href: homeHref, onNavigate: (href) => void navigate(href) }}
      tone={tone}
    />
  );
}
