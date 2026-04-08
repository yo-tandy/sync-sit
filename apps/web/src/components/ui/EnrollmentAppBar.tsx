import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { Dialog } from './Dialog';
import {
  InfoIcon,
  MailIcon,
  ShieldIcon,
  FileTextIcon,
  LogOutIcon,
} from './Icons';

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

export function EnrollmentAppBar() {
  const { t } = useTranslation();
  const { logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between bg-red-600 px-4">
        <div className="w-8" />
        <span className="text-sm font-semibold text-white">Sync/Sit</span>
        <button
          onClick={() => setMenuOpen(true)}
          className="flex h-8 w-8 items-center justify-center text-white"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="-m-6 overflow-hidden rounded-xl">
          <MenuItem icon={<InfoIcon className="h-5 w-5" />} label={t('menu.about')} to="/about" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.reportProblem')} to="/report" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('menu.privacyPolicy')} to="/privacy" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<FileTextIcon className="h-5 w-5" />} label={t('menu.terms')} to="/terms" onNavigate={() => setMenuOpen(false)} />

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
