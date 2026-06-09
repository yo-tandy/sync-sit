import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function WelcomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex h-[100svh] flex-col px-6 py-3">
      {/* Logo + Title */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <img
          src="/logo.png"
          alt={t('welcome.title')}
          className="mb-4 h-40 w-40 rounded-2xl object-cover sm:h-52 sm:w-52"
        />
        <h1 className="mb-1 text-center text-3xl font-bold text-gray-950">
          {t('welcome.title')}
        </h1>
        <p className="max-w-[280px] text-center text-sm leading-relaxed text-gray-500">
          {t('welcome.subtitle')}
        </p>
      </div>

      {/* Actions */}
      <div className="shrink-0 pb-6">
        <Link
          to="/signup"
          className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90"
        >
          {t('welcome.ctaSignUp')}
        </Link>

        <Link
          to="/login"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950"
        >
          {t('welcome.ctaLogin')}
        </Link>
      </div>
    </div>
  );
}
