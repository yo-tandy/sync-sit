import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import {
  Dialog,
  LanguageSelector,
  HomeIcon,
  UserIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardListIcon,
  BellIcon,
  InfoIcon,
  ShieldIcon,
  FileTextIcon,
  MailIcon,
  LogOutIcon,
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
 * Sync/Study tutor portal app bar. Copy-adapted from sync-sit's AppBar
 * (apps/web/src/components/ui/AppBar.tsx) — same sticky branded bar + hamburger
 * menu treatment, retargeted to the tutor portal. Every menu link resolves to a
 * route that exists after Task 1 (the /tutor block + the public
 * about/report/privacy/terms pages). Dashboard is reached via the home icon.
 */
export function AppBar() {
  const { t } = useTranslation();
  const { userDoc, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between bg-red-600 px-4">
        <Link to="/tutor" className="flex h-8 w-8 items-center justify-center text-white">
          <HomeIcon className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-white">Sync/Study</span>
        <button
          onClick={() => setMenuOpen(true)}
          className="flex h-8 w-8 items-center justify-center text-white"
          aria-label={t('menu.openMenu')}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="-m-6 overflow-hidden rounded-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-base font-bold text-gray-900">{userDoc?.firstName} {userDoc?.lastName}</p>
            <p className="text-xs text-gray-500">{userDoc?.email}</p>
          </div>

          <MenuItem icon={<BellIcon className="h-5 w-5" />} label={t('tutor.requestsTitle')} to="/tutor/requests" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<CalendarIcon className="h-5 w-5" />} label={t('tutor.sessionsTitle')} to="/tutor/sessions" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<CheckIcon className="h-5 w-5" />} label={t('tutor.endorsementsTitle')} to="/tutor/endorsements" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<UserIcon className="h-5 w-5" />} label={t('tutor.accountTitle')} to="/tutor/account" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ClipboardListIcon className="h-5 w-5" />} label={t('tutor.subjectsTitle')} to="/tutor/subjects" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<CalendarIcon className="h-5 w-5" />} label={t('tutor.scheduleTitle')} to="/tutor/schedule" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('tutor.verificationTitle')} to="/tutor/verification" onNavigate={() => setMenuOpen(false)} />

          <div className="border-t border-gray-100" />

          <MenuItem icon={<InfoIcon className="h-5 w-5" />} label={t('menu.about')} to="/about" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.reportProblem')} to="/report" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('menu.privacyPolicy')} to="/privacy" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<FileTextIcon className="h-5 w-5" />} label={t('menu.terms')} to="/terms" onNavigate={() => setMenuOpen(false)} />

          <div className="border-t border-gray-100" />

          <AppSwitchMenuItem />

          <div className="px-4 py-3">
            <LanguageSelector />
          </div>

          <div className="border-t border-gray-100" />

          <MenuItem
            icon={<LogOutIcon className="h-5 w-5" />}
            label={t('common.signOut')}
            onClick={() => { setMenuOpen(false); logout(); }}
          />
        </div>
      </Dialog>
    </>
  );
}
