import { useTranslation } from 'react-i18next';
import { Spinner } from '@ejm/shared-ui';
import { useSitSwitch } from '@/hooks/useSitSwitch';
import { SIT_VERIFICATION_PATH } from '@/utils/appSwitch';

/**
 * The unverified-family banner (issue #129). Family verification lives in
 * sync-sit; instead of merely telling the parent to go there, the CTA runs
 * the one-click cross-app switch (useSitSwitch) deep-linked straight to
 * sit's verification page. Same idiom as AppSwitchMenuItem: non-optimistic
 * pending state, and on mint failure the banner falls back to what it was
 * before — the plain explanatory text — plus the standard switch error, with
 * the CTA re-enabled for a retry.
 */
export function VerifyFamilyBanner() {
  const { t } = useTranslation();
  const { busy, failed, switchToSit } = useSitSwitch(SIT_VERIFICATION_PATH);

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
      <p className="mb-1 text-sm font-semibold">{t('family.dashboard.verifyBannerTitle')}</p>
      <p className="text-xs text-amber-700">{t('family.dashboard.verifyBannerDesc')}</p>
      <button
        type="button"
        onClick={() => void switchToSit()}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {busy && <Spinner className="h-4 w-4" />}
        {t('family.dashboard.verifyBannerCta')}
      </button>
      {failed && <p className="mt-2 text-xs text-brand-600">{t('appSwitch.error')}</p>}
    </div>
  );
}
