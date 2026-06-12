import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../components/LanguageSelector.js';

interface WelcomePageProps {
  logoSrc: string;
  logoAlt?: string;
  redirectPath?: string | null;
  authLoading?: boolean;
}

export function WelcomePage({ logoSrc, logoAlt, redirectPath, authLoading }: WelcomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (redirectPath) navigate(redirectPath);
  }, [authLoading, redirectPath, navigate]);

  return (
    <div className="flex h-[100svh] flex-col px-6 py-3">
      <div className="flex shrink-0 justify-end">
        <LanguageSelector />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <img
          src={logoSrc}
          alt={logoAlt ?? t('welcome.title')}
          className="mb-3 h-32 w-32 rounded-2xl object-cover sm:h-40 sm:w-40"
        />
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-950">
          {t('welcome.title')}
        </h1>
        <p className="max-w-[260px] text-center text-sm leading-relaxed text-gray-500">
          {t('welcome.subtitle')}
        </p>
      </div>

      <div className="shrink-0">
        <Link to="/login" className="mb-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90">
          {t('welcome.logIn')}
        </Link>
        <Link to="/signup" className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950">
          {t('welcome.signUp')}
        </Link>
        <div className="flex justify-center gap-4 pb-1 pt-1">
          <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.about')}</Link>
          <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.privacy')}</Link>
          <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.terms')}</Link>
          <Link to="/report" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.help')}</Link>
        </div>
      </div>
    </div>
  );
}
