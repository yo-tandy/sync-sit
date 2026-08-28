import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@ejm/shared-ui';

/**
 * Placeholder behind the sign-up role cards until doer/parent enrollment
 * lands (plan §13 PR4) — the same "ship stubs, then swap" move sync-study's
 * scaffold used (PR #57), stated up front per plan §12.
 */
export function ComingSoonPage() {
  const { t } = useTranslation();
  return (
    <div>
      <TopNav title={t('comingSoon.title')} backTo="back" />
      <div className="flex flex-col items-center px-6 pt-10">
        <img src="/logo.png" alt="Sync/Do" className="mb-6 h-24 w-24 rounded-2xl" />
        <p className="mb-8 max-w-sm text-center text-sm leading-relaxed text-gray-600">
          {t('comingSoon.body')}
        </p>
        <Link
          to="/"
          className="flex h-12 w-full max-w-sm items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-600/90"
        >
          {t('comingSoon.backHome')}
        </Link>
      </div>
    </div>
  );
}
