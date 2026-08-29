import { useState } from 'react';
import { SUPPORT_EMAIL } from '@/constants/brand';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { Dialog } from './Dialog';
import {
  HomeIcon,
  UserIcon,
  UsersIcon,
  CalendarIcon,
  SettingsIcon,
  InfoIcon,
  ShieldIcon,
  FileTextIcon,
  MailIcon,
  LogOutIcon,
  ClipboardListIcon,
  DownloadIcon,
  ShareIcon,
} from './Icons';
import { LanguageSelector } from './LanguageSelector';
import { NavTabs } from './NavTabs';
import { NotificationBell } from './NotificationBell';
import { SupervisionChip } from './SupervisionChip';
import { AppSwitchMenuItem } from './AppSwitchMenuItem';
import type { UserRole } from '@ejm/sit-core';

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

export function AppBar({ role }: { role: UserRole }) {
  const { t } = useTranslation();
  const { userDoc, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const homePath = role === 'babysitter' ? '/babysitter' : role === 'admin' ? '/admin' : '/family';

  // The portal's primary destinations — one list, two renderings (issue
  // #119): the burger dialog below and the md+ NavTabs row. Dashboard stays
  // on the home icon, mirroring the burger. Admin gets no tab row: its
  // desktop nav is the grouped sidebar in AdminLayout.
  const primaryNav =
    role === 'babysitter'
      ? [
          { to: '/babysitter/account', icon: <UserIcon className="h-5 w-5" />, label: t('menu.myAccount') },
          { to: '/babysitter/options', icon: <SettingsIcon className="h-5 w-5" />, label: t('menu.babysittingOptions') },
          { to: '/babysitter/endorsements', icon: <UsersIcon className="h-5 w-5" />, label: t('menu.references') },
          { to: '/babysitter/families', icon: <UsersIcon className="h-5 w-5" />, label: t('menu.myFamilies') },
        ]
      : role === 'parent'
        ? [
            // Section 1 -- who you are and how the family is configured.
            { to: '/family/account', icon: <UserIcon className="h-5 w-5" />, label: t('menu.myAccount') },
            { to: '/family/settings', icon: <SettingsIcon className="h-5 w-5" />, label: t('menu.myFamily') },
            { to: '/family/governance', icon: <ShieldIcon className="h-5 w-5" />, label: t('governance.menuTitle') },
            { to: '/family/verification', icon: <ShieldIcon className="h-5 w-5" />, label: t('verification.menuTitle') },
          ]
        : [];

  // Section 2 -- what you are DOING with the app, in the owner's order
  // (issue #339). Co-parent is deliberately absent: it moved inside family
  // settings (issue #340).
  const activityNav =
    role === 'parent'
      ? [
          { to: '/family/appointments', icon: <CalendarIcon className="h-5 w-5" />, label: t('menu.myAppointments') },
          { to: '/family/endorsements', icon: <FileTextIcon className="h-5 w-5" />, label: t('menu.myReferences') },
          { to: '/family/preferred', icon: <UsersIcon className="h-5 w-5" />, label: t('menu.preferredBabysitters') },
        ]
      : [];

  return (
    <>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between bg-brand-600 px-4">
        <Link to={homePath} aria-label={t('menu.home')} className="-m-1.5 flex h-11 w-11 items-center justify-center text-white">
          <HomeIcon className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-white">{role === 'admin' ? 'Sync/Sit - Admin Panel' : 'Sync/Sit'}</span>
        <div className="flex items-center gap-2">
          {role === 'babysitter' && userDoc?.governedBy && (
            <SupervisionChip
              label={t('supervision.chipLabel')}
              ariaLabel={t('supervision.chipAria')}
              to="/supervision-info"
            />
          )}
          <NotificationBell to={`${homePath}/notifications`} />
          <button
            onClick={() => setMenuOpen(true)}
            aria-label={t('menu.openMenu')}
            className="-m-1.5 flex h-11 w-11 items-center justify-center text-white"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Persistent primary nav at md+ (issue #119); the burger stays the
          phone entry point and, at desktop, the home of the secondary items. */}
      {[...primaryNav, ...activityNav].length > 0 && (
        <NavTabs
          items={[...primaryNav, ...activityNav].map(({ to, label }) => ({ to, label }))}
          ariaLabel={t('menu.primaryNav')}
        />
      )}

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} ariaLabel={t('menu.appMenu')}>
        <div className="focus-ring-inset -m-6 overflow-hidden rounded-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-base font-bold text-gray-900">{userDoc?.firstName} {userDoc?.lastName}</p>
            <p className="text-xs text-gray-500">{userDoc?.email}</p>
          </div>

          {primaryNav.map((item) => (
            <MenuItem key={item.to} icon={item.icon} label={item.label} to={item.to} onNavigate={() => setMenuOpen(false)} />
          ))}

          {activityNav.length > 0 && <div className="border-t border-gray-100" />}
          {activityNav.map((item) => (
            <MenuItem key={item.to} icon={item.icon} label={item.label} to={item.to} onNavigate={() => setMenuOpen(false)} />
          ))}

          {role === 'admin' && (
            <>
              <MenuItem icon={<UsersIcon className="h-5 w-5" />} label={t('admin.manageUsers')} to="/admin/users" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<CalendarIcon className="h-5 w-5" />} label={t('admin.manageAppointments')} to="/admin/appointments" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<CalendarIcon className="h-5 w-5" />} label={t('admin.holidays')} to="/admin/holidays" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('admin.verifications')} to="/admin/verifications" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<UsersIcon className="h-5 w-5" />} label={t('admin.governance.menuTitle')} to="/admin/governance" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<ClipboardListIcon className="h-5 w-5" />} label={t('admin.auditLog')} to="/admin/audit-log" onNavigate={() => setMenuOpen(false)} />
              <MenuItem icon={<DownloadIcon className="h-5 w-5" />} label={t('admin.gdprExport')} to="/admin/gdpr-export" onNavigate={() => setMenuOpen(false)} />
              <div className="px-4 py-3">
                <LanguageSelector />
              </div>
            </>
          )}

          <div className="border-t border-gray-100" />

          {/* Section 3 -- cross-app and language (issue #339). Language was
              previously rendered for admins ONLY; every role has a selector
              now. Admins keep theirs inside the admin block above rather than
              here, so "every role has one" is true but "every role has it in
              section 3" is not -- noted so the next reader isn't surprised
              (PR #343 round 4). */}
          <MenuItem icon={<ShareIcon className="h-5 w-5" />} label={t('share.title')} to="/share" onNavigate={() => setMenuOpen(false)} />
          <AppSwitchMenuItem />
          {role !== 'admin' && (
            <div className="px-4 py-3">
              <LanguageSelector />
            </div>
          )}

          <div className="border-t border-gray-100" />

          {/* Section 4 -- support and legal. Report a problem is kept beside
              Send feedback: the owner's list names only the latter, but
              deleting a working support surface was not asked for. */}
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.sendFeedback')} onClick={() => { setMenuOpen(false); window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Feedback — Sync/Sit')}`; }} />
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.reportProblem')} to="/report" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<InfoIcon className="h-5 w-5" />} label={t('menu.about')} to="/about" onNavigate={() => setMenuOpen(false)} />
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
