import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { UserIcon, UsersIcon } from '@/components/ui/Icons';
import { LanguageSelector } from '@/components/ui';

export function WelcomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col px-6 py-8">
      {/* Language toggle top-right */}
      <div className="flex justify-end">
        <LanguageSelector />
      </div>

      {/* Logo + Title */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <img src="/logo.png" alt="Sync/Sit" className="mb-6 h-72 w-72 rounded-3xl" />
        <h1 className="mb-2 text-center text-3xl font-bold text-gray-950">
          {t('welcome.title')}
        </h1>
        <p className="max-w-[260px] text-center text-base leading-relaxed text-gray-500">
          {t('welcome.subtitle')}
        </p>
      </div>

      {/* Actions */}
      <div className="pb-8">
        <p className="mb-4 text-center text-sm font-medium text-gray-500">
          {t('welcome.iAmA')}
        </p>

        <Link
          to="/enroll/babysitter"
          className="mb-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90"
        >
          <UserIcon className="h-5 w-5" />
          {t('welcome.babysitter')}
        </Link>

        <Link
          to="/enroll/parent"
          className="mb-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950"
        >
          <UsersIcon className="h-5 w-5" />
          {t('welcome.parent')}
        </Link>

        <div className="text-center">
          <span className="text-sm text-gray-500">
            {t('welcome.alreadyHaveAccount')}{' '}
          </span>
          <Link
            to="/login"
            className="text-sm font-semibold text-red-600 hover:underline"
          >
            {t('welcome.logIn')}
          </Link>
        </div>
      </div>

      {/* Footer links */}
      <div className="flex justify-center gap-4 pb-2">
        <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600">
          {t('welcome.about')}
        </Link>
        <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600">
          {t('welcome.privacy')}
        </Link>
        <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600">
          {t('welcome.terms')}
        </Link>
        <Link to="/report" className="text-xs text-gray-400 hover:text-gray-600">
          {t('welcome.help')}
        </Link>
      </div>
    </div>
  );
}
