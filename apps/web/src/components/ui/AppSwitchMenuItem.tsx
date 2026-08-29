import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { STUDY_APP_URL } from '@/lib/appSwitch';
import { BRAND_MARKS } from '@ejm/shared-ui';
import { Spinner } from './Spinner';

// Bar-weight mark, not the 256px original (#364): this slot is 20px, and the
// full mark costs ~100 KB to draw it. Resolved through BRAND_MARKS so
// replacing the art stays one file plus the assets (#386).
const studyMark = BRAND_MARKS.study;

/**
 * Burger-menu entry that jumps to sync-study without re-login: mints a
 * one-time handoff code, then navigates with the code in the URL FRAGMENT
 * (#code=… — fragments never reach servers or logs). Non-optimistic: the
 * entry disables with a spinner until the mint resolves; nothing navigates
 * on failure.
 *
 * Hidden below `md` by AppBar for the parent and babysitter portals since
 * #365, because there the app-switch bar is the entry point and a second one
 * would let a code be minted around the bar's whole-bar lock. At `md+` the
 * bar is `md:hidden` and this is the only switcher there is, until Q9 is
 * answered (#417). ADMIN keeps it at every width: AdminLayout renders no
 * AppSwitchBarHost, so hiding it there would leave admins with no switcher
 * on a phone at all.
 */
export function AppSwitchMenuItem() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const mint = httpsCallable<Record<string, never>, { code: string }>(
        functions,
        'createAppHandoffCode',
      );
      const res = await mint({});
      // Carry the CURRENT language across origins (i18n caches are
      // per-origin localStorage): the handoff page applies it on arrival.
      // Whitelisted at the source (mirrors the receiver's en|fr allowlist) —
      // i18n.language originates from localStorage/navigator via the detector.
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      window.location.assign(
        `${STUDY_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={busy} className="w-full text-left">
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
        <span className="text-gray-400">
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <img
              src={studyMark.sm}
              srcSet={`${studyMark.sm} 1x, ${studyMark.md} 2x`}
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 rounded object-contain"
            />
          )}
        </span>
        <span>{t('appSwitch.toStudy')}</span>
      </div>
      {failed && <p className="px-4 pb-2 text-xs text-brand-600">{t('appSwitch.error')}</p>}
    </button>
  );
}
