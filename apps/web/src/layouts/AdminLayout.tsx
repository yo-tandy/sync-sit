import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDocumentGround } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { PageContainer } from '@/components/ui/PageContainer';
import { SideNav } from '@/components/ui/SideNav';
import {
  HomeIcon,
  UsersIcon,
  ShieldIcon,
  UserPlusIcon,
  CalendarIcon,
  ClipboardListIcon,
  DownloadIcon,
} from '@/components/ui/Icons';
import { ScrollToTop } from '@/components/ScrollToTop';

export function AdminLayout() {
  const { t } = useTranslation();
  // Ground reaches html too (#424) — the ADMIN one (decision 25): iOS
  // overscroll + the AuthGuard resolve state paint the canvas, which no
  // descendant div can tint.
  useDocumentGround('admin');

  // Desktop sidebar (issue #119): the dashboard's grouped destinations
  // (People / Trust & safety / Operations, the #140 regrouping) plus the
  // dashboard itself. Admin is the one portal with too many destinations for
  // a tab row, so it gets the sidebar rendering of persistent nav; the burger
  // stays the phone entry point.
  const sections = [
    {
      items: [
        { to: '/admin', label: t('admin.dashboard'), icon: <HomeIcon className="h-5 w-5" />, end: true },
      ],
    },
    {
      title: t('admin.nav.people'),
      items: [
        { to: '/admin/users', label: t('admin.manageUsers'), icon: <UsersIcon className="h-5 w-5" /> },
        { to: '/admin/families', label: t('admin.familiesPage.title'), icon: <HomeIcon className="h-5 w-5" /> },
      ],
    },
    {
      title: t('admin.nav.trustSafety'),
      items: [
        { to: '/admin/verifications', label: t('admin.verifications'), icon: <ShieldIcon className="h-5 w-5" /> },
        { to: '/admin/enrollment-access', label: t('admin.enrollmentAccess.title'), icon: <UserPlusIcon className="h-5 w-5" /> },
        { to: '/admin/governance', label: t('admin.governance.title'), icon: <ShieldIcon className="h-5 w-5" /> },
      ],
    },
    {
      title: t('admin.nav.operations'),
      items: [
        { to: '/admin/appointments', label: t('admin.manageAppointments'), icon: <CalendarIcon className="h-5 w-5" /> },
        { to: '/admin/do-tasks', label: t('admin.doTasks.title'), icon: <ClipboardListIcon className="h-5 w-5" /> },
        { to: '/admin/holidays', label: t('admin.holidays'), icon: <CalendarIcon className="h-5 w-5" /> },
        { to: '/admin/configuration', label: t('admin.config.title'), icon: <ClipboardListIcon className="h-5 w-5" /> },
        { to: '/admin/audit-log', label: t('admin.auditLog'), icon: <ClipboardListIcon className="h-5 w-5" /> },
        { to: '/admin/gdpr-export', label: t('admin.gdprExport'), icon: <DownloadIcon className="h-5 w-5" /> },
      ],
    },
  ];

  return (
    <AuthGuard role="admin">
      <div className="min-h-screen bg-ground-admin">
        <ScrollToTop />
        <AppBar role="admin" />
        <div className="md:flex">
          <SideNav sections={sections} ariaLabel={t('menu.primaryNav')} />
          {/* min-w-0 lets DataTables shrink inside the flex row instead of
              forcing horizontal page scroll. */}
          <div className="min-w-0 flex-1">
            {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
            <PageContainer>
              <Outlet />
            </PageContainer>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
