import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '../components/Icons.js';

/**
 * Landing point after `deleteMyAccount` succeeds (#491).
 *
 * PUBLIC by construction: the member is signed out (by `DeleteAccountSection`)
 * before they ever arrive here, so this must render with no auth guard in
 * any host router — it sits in the same public group as `WelcomePage` /
 * `LoginPage`, never inside `AccountLayout` (whose `AuthGuard` would just
 * bounce a signed-out visitor straight back off it).
 *
 * NO BACK BUTTON, deliberately: the account this page would go "back" to no
 * longer exists. The only way onward is `homeHref`, the public landing page.
 */
export interface AccountDeletedPageProps {
  /** Same-origin path to the public landing page. Defaults to '/'. */
  homeHref?: string;
}

export function AccountDeletedPage({ homeHref = '/' }: AccountDeletedPageProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <CheckIcon className="h-6 w-6 text-gray-500" />
      </div>
      <h1 className="mb-2 text-xl font-bold text-gray-900">{t('accountDeleted.title')}</h1>
      <p className="mb-6 max-w-sm text-sm text-gray-500">{t('accountDeleted.body')}</p>
      <Link to={homeHref} className="text-sm font-semibold text-brand-600 hover:underline">
        {t('accountDeleted.backHome')}
      </Link>
    </div>
  );
}
