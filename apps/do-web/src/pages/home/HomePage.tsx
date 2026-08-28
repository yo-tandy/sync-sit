import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, LanguageSelector } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { AppSwitchMenuItem } from '@/components/ui/AppSwitchMenuItem';

/**
 * Authenticated shell placeholder (plan §13 PR2: "empty shell that builds
 * and deploys, in brand"). A bare dashboard: brand header, a what's-coming
 * card, the cross-app switcher OUT to the siblings (§9.5's asymmetric
 * shape), and sign-out. The real family/doer portals replace this at
 * plan §13 PR7/PR8.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const handleSignOut = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-md px-5 py-4">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-10 w-10 rounded-xl" />
          <span className="text-lg font-bold text-gray-950">{t('welcome.title')}</span>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          {t('common.signOut')}
        </button>
      </header>

      <Card elevated className="mb-6 border-brand-100 bg-brand-50">
        <h1 className="mb-2 text-lg font-bold text-brand-800">{t('home.comingSoonTitle')}</h1>
        <p className="text-sm leading-relaxed text-gray-600">{t('home.comingSoonBody')}</p>
      </Card>

      <p className="mb-2 text-sm text-gray-500">{t('home.switchHint')}</p>
      <Card className="mb-6 p-0">
        <AppSwitchMenuItem target="sit" />
        <div className="border-t border-gray-100" />
        <AppSwitchMenuItem target="study" />
      </Card>

      <div className="flex justify-center">
        <LanguageSelector />
      </div>
    </div>
  );
}
