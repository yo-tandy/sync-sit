import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  Badge,
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
  ShareIcon,
  UsersIcon,
  SupervisionChip,
  NavTabs,
} from '@ejm/shared-ui';
import { AppSwitchMenuItem } from './AppSwitchMenuItem';
import { NotificationBell } from './NotificationBell';

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function MenuItem({ icon, label, badge, to, onClick, onNavigate }: { icon: React.ReactNode; label: string; badge?: number; to?: string; onClick?: () => void; onNavigate?: () => void }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
      <span className="text-gray-400">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="amber" className="ml-auto">{badge}</Badge>
      )}
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
  const { userDoc, firebaseUser, logout } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingEndorsements, setPendingEndorsements] = useState(0);

  // Pending-endorsement count for the Endorsements menu badge (issue #196 —
  // the #194 dashboard rework dropped the dashboard count, leaving no signal
  // that an endorsement awaits Accept/Dismiss). Same read as the tutor
  // EndorsementsPage and the pre-#194 dashboard loadEndorsementCount: the
  // shared `references` collection keyed by tutorUserId (sit references are
  // keyed by babysitterUserId, so this query never sees them), counting
  // status 'private' — the only tutor-actionable state — client-side. Live
  // via onSnapshot (family RequestsPage idiom) so the badge clears as the
  // tutor responds without a remount. A failed read must never surface in
  // the app bar: error or throw just means no badge.
  useEffect(() => {
    if (!uid) return;
    try {
      return onSnapshot(
        query(collection(db, 'references'), where('tutorUserId', '==', uid)),
        (snap) => {
          setPendingEndorsements(snap.docs.filter((d) => d.data()?.status === 'private').length);
        },
        () => setPendingEndorsements(0),
      );
    } catch {
      /* leave the badge hidden */
    }
  }, [uid]);

  const menuHasBadge = pendingEndorsements > 0;

  // The tutor portal's primary destinations — one list, two renderings
  // (issue #119): the burger dialog below and the md+ NavTabs row. Dashboard
  // stays on the home icon, mirroring the burger.
  const primaryNav = [
    { to: '/tutor/requests', icon: <BellIcon className="h-5 w-5" />, label: t('tutor.requestsTitle') },
    // "My families" mirrors sync-sit's babysitter menu entry (UsersIcon → /babysitter/families).
    { to: '/tutor/families', icon: <UsersIcon className="h-5 w-5" />, label: t('tutor.familiesTitle') },
    { to: '/tutor/sessions', icon: <CalendarIcon className="h-5 w-5" />, label: t('tutor.sessionsTitle') },
    { to: '/tutor/endorsements', icon: <CheckIcon className="h-5 w-5" />, label: t('tutor.endorsementsTitle'), badge: pendingEndorsements },
    { to: '/tutor/account', icon: <UserIcon className="h-5 w-5" />, label: t('tutor.accountTitle') },
    { to: '/tutor/subjects', icon: <ClipboardListIcon className="h-5 w-5" />, label: t('tutor.subjectsTitle') },
    { to: '/tutor/schedule', icon: <CalendarIcon className="h-5 w-5" />, label: t('tutor.scheduleTitle') },
  ];

  return (
    <>
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between bg-brand-600 px-4">
        <Link to="/tutor" aria-label={t('menu.home')} className="-m-1.5 flex h-11 w-11 items-center justify-center text-white">
          <HomeIcon className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-white">Sync/Study</span>
        <div className="flex items-center gap-2">
          {userDoc?.governedBy && (
            <SupervisionChip
              label={t('supervision.chipLabel')}
              ariaLabel={t('supervision.chipAria')}
              to="/supervision-info"
            />
          )}
          <NotificationBell to="/tutor/notifications" />
          <button
            onClick={() => setMenuOpen(true)}
            className="relative -m-1.5 flex h-11 w-11 items-center justify-center text-white"
            aria-label={menuHasBadge ? t('menu.openMenuPending') : t('menu.openMenu')}
          >
            <MenuIcon className="h-5 w-5" />
            {/* Closed-menu signal that some entry inside carries a badge; the
                aria-label swap above is the screen-reader equivalent. */}
            {menuHasBadge && (
              <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      </div>

      {/* Persistent primary nav at md+ (issue #119); the burger stays the
          phone entry point and, at desktop, the home of the secondary items. */}
      <NavTabs
        items={primaryNav.map(({ to, label, badge }) => ({ to, label, badge }))}
        ariaLabel={t('menu.primaryNav')}
      />

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="-m-6 overflow-hidden rounded-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-base font-bold text-gray-900">{userDoc?.firstName} {userDoc?.lastName}</p>
            <p className="text-xs text-gray-500">{userDoc?.email}</p>
          </div>

          {primaryNav.map((item) => (
            <MenuItem key={item.to} icon={item.icon} label={item.label} badge={item.badge} to={item.to} onNavigate={() => setMenuOpen(false)} />
          ))}

          <div className="border-t border-gray-100" />

          <MenuItem icon={<InfoIcon className="h-5 w-5" />} label={t('menu.about')} to="/about" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<MailIcon className="h-5 w-5" />} label={t('menu.reportProblem')} to="/report" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<ShieldIcon className="h-5 w-5" />} label={t('menu.privacyPolicy')} to="/privacy" onNavigate={() => setMenuOpen(false)} />
          <MenuItem icon={<FileTextIcon className="h-5 w-5" />} label={t('menu.terms')} to="/terms" onNavigate={() => setMenuOpen(false)} />

          <div className="border-t border-gray-100" />

          <MenuItem icon={<ShareIcon className="h-5 w-5" />} label={t('share.title')} to="/share" onNavigate={() => setMenuOpen(false)} />
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
