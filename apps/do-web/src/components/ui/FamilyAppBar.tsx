import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import {
  Dialog,
  LanguageSelector,
  HomeIcon,
  PlusIcon,
  InfoIcon,
  ShieldIcon,
  FileTextIcon,
  ClipboardListIcon,
  MailIcon,
  LogOutIcon,
  NavTabs,
} from '@ejm/shared-ui';
import { AppSwitchMenuItem } from './AppSwitchMenuItem';

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function MenuItem({ icon, label, to, onClick, onNavigate }: { icon: React.ReactNode; label: string; to?: string; onClick?: () => void; onNavigate?: () => void }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
      <span className="text-gray-400">{icon}</span>
      <span>{label}</span>
    </div>
  );
  if (to) return <Link to={to} className="block" onClick={onNavigate}>{inner}</Link>;
  return <button type="button" onClick={onClick} className="w-full text-left">{inner}</button>;
}

/**
 * Sync/Do family portal app bar — study-web's FamilyAppBar shape (sticky
 * branded bar + hamburger + md+ NavTabs; chrome intentionally duplicated
 * per portal), reduced to PR7's two primary destinations: My tasks and Post
 * a task. Account/settings/verification entries arrive with their surfaces;
 * the burger carries the public pages, the OUT-going app switch (plan §9.5's
 * asymmetric shape) and sign-out.
 */
export function FamilyAppBar() {
  const { t } = useTranslation();
  const { userDoc, logout } = useAuthStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const primaryNav = [
    { to: '/family', icon: <ClipboardListIcon className="h-5 w-5" />, label: t('family.nav.myTasks') },
    { to: '/family/post', icon: <PlusIcon className="h-5 w-5" />, label: t('family.nav.postTask') },
  ];

  return (
    <>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between bg-brand-600 px-4">
        <Link to="/family" aria-label={t('menu.home')} className="-m-1.5 flex h-11 w-11 items-center justify-center text-white">
          <HomeIcon className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-white">Sync/Do</span>
        <button
          onClick={() => setMenuOpen(true)}
          className="-m-1.5 flex h-11 w-11 items-center justify-center text-white"
          aria-label={t('menu.openMenu')}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      <NavTabs
        items={primaryNav.map(({ to, label }) => ({ to, label }))}
        ariaLabel={t('menu.primaryNav')}
      />

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} ariaLabel={t('menu.appMenu')}>
        <div className="-m-6 overflow-hidden rounded-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-base font-bold text-gray-900">{userDoc?.firstName} {userDoc?.lastName}</p>
            <p className="text-xs text-gray-500">{userDoc?.email}</p>
          </div>

          {primaryNav.map((item) => (
            <MenuItem key={item.to} icon={item.icon} label={item.label} to={item.to} onNavigate={() => setMenuOpen(false)} />
          ))}

          <div className="border-t border-gray-100" />

          <MenuItem icon={<InfoIcon className="h-5 w-5" />} label={t('menu.about')} to="/about" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.reportProblem')} to="/report" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('menu.privacyPolicy')} to="/privacy" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<FileTextIcon className="h-5 w-5" />} label={t('menu.terms')} to="/terms" onNavigate={() => setMenuOpen(false)} />

          <div className="border-t border-gray-100" />

          <AppSwitchMenuItem target="sit" />
          <AppSwitchMenuItem target="study" />

          <div className="px-4 py-3">
            <LanguageSelector />
          </div>

          <div className="border-t border-gray-100" />

          <MenuItem
            icon={<LogOutIcon className="h-5 w-5" />}
            label={t('common.signOut')}
            onClick={async () => {
              setMenuOpen(false);
              await logout();
              navigate('/');
            }}
          />
        </div>
      </Dialog>
    </>
  );
}
