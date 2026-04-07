import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '@/components/ui';

export function WelcomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex h-[100dvh] flex-col justify-between px-6 py-4">
      {/* Language toggle top-right */}
      <div className="flex shrink-0 justify-end">
        <LanguageSelector />
      </div>

      {/* Logo + Title */}
      <div className="flex flex-col items-center justify-center py-4">
        <img src="/logo.png" alt="Sync/Sit" className="mb-3 h-36 w-36 rounded-2xl sm:h-44 sm:w-44" />
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-950">
          {t('welcome.title')}
        </h1>
        <p className="max-w-[260px] text-center text-sm leading-relaxed text-gray-500">
          {t('welcome.subtitle')}
        </p>
      </div>

      {/* Actions + Footer */}
      <div className="shrink-0">
        <Link
          to="/login"
          className="mb-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90"
        >
          {t('welcome.logIn')}
        </Link>

        <Link
          to="/signup"
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950"
        >
          {t('welcome.signUp')}
        </Link>

        <div className="flex justify-center gap-4 pb-1 pt-1">
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
    </div>
  );
}
