import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../components/LanguageSelector.js';

interface WelcomePageProps {
  logoSrc: string;
  logoAlt?: string;
  redirectPath?: string | null;
  authLoading?: boolean;
  /**
   * Where the "Sign up" CTA goes. Defaults to `/signup` — every app still
   * mounts that route (issue #435 milestone, PR5 keeps it resolving as a
   * redirect for bookmarks/stale links), so callers that don't pass this
   * keep working unchanged.
   *
   * A same-origin path renders as a client-side `<Link>` (apps/web passes
   * `/enroll` directly: its own entry point now IS the unified landing
   * page). A full `http(s)://` URL renders as a plain `<a>` instead —
   * study/do pass sit's absolute cross-origin `/enroll` URL here so their
   * own CTA click skips their local `/signup` redirect hop too.
   */
  signUpTo?: string;
}

export function WelcomePage({
  logoSrc,
  logoAlt,
  redirectPath,
  authLoading,
  signUpTo = '/signup',
}: WelcomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signUpIsExternal = /^https?:\/\//.test(signUpTo);

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
        <Link to="/login" className="mb-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white transition-colors hover:bg-brand-600/90">
          {t('welcome.logIn')}
        </Link>
        {signUpIsExternal ? (
          <a href={signUpTo} className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950">
            {t('welcome.signUp')}
          </a>
        ) : (
          <Link to={signUpTo} className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950">
            {t('welcome.signUp')}
          </Link>
        )}
        <div className="flex justify-center gap-4 pb-1 pt-1">
          <Link to="/about" className="text-xs text-gray-500 hover:text-gray-600">{t('welcome.about')}</Link>
          <Link to="/privacy" className="text-xs text-gray-500 hover:text-gray-600">{t('welcome.privacy')}</Link>
          <Link to="/terms" className="text-xs text-gray-500 hover:text-gray-600">{t('welcome.terms')}</Link>
          <Link to="/report" className="text-xs text-gray-500 hover:text-gray-600">{t('welcome.help')}</Link>
        </div>
      </div>
    </div>
  );
}
