import { useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { UsersIcon, UserPlusIcon, CalendarIcon, ClipboardListIcon, DownloadIcon, ShieldIcon, HomeIcon } from '@/components/ui/Icons';
import { useAdminStore } from '@/stores/adminStore';

export function AdminDashboard() {
  const { t } = useTranslation();
  const { stats, statsLoading, fetchStats } = useAdminStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const navGroups = [
    {
      title: t('admin.nav.people'),
      cards: [
        {
          to: '/admin/users',
          icon: <UsersIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.manageUsers'),
          description: t('admin.manageUsersDesc'),
        },
        {
          to: '/admin/families',
          icon: <HomeIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.familiesPage.title'),
          description: t('admin.familiesPage.desc'),
        },
      ],
    },
    {
      title: t('admin.nav.trustSafety'),
      cards: [
        {
          to: '/admin/verifications',
          icon: <ShieldIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.verifications'),
          description: t('admin.verificationsDesc'),
        },
        {
          to: '/admin/enrollment-access',
          icon: <UserPlusIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.enrollmentAccess.title'),
          description: t('admin.enrollmentAccess.desc'),
        },
        {
          to: '/admin/governance',
          icon: <ShieldIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.governance.title'),
          description: t('admin.governance.navDesc'),
        },
      ],
    },
    {
      title: t('admin.nav.operations'),
      cards: [
        {
          to: '/admin/appointments',
          icon: <CalendarIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.manageAppointments'),
          description: t('admin.manageAppointmentsDesc'),
        },
        {
          to: '/admin/holidays',
          icon: <CalendarIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.holidays'),
          description: t('admin.holidaysDesc'),
        },
        {
          to: '/admin/configuration',
          icon: <ClipboardListIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.config.title'),
          description: t('admin.config.navDesc'),
        },
        {
          to: '/admin/audit-log',
          icon: <ClipboardListIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.auditLog'),
          description: t('admin.auditLogDesc'),
        },
        {
          to: '/admin/gdpr-export',
          icon: <DownloadIcon className="h-6 w-6 text-brand-600" />,
          title: t('admin.gdprExport'),
          description: t('admin.gdprExportDesc'),
        },
      ],
    },
  ];

  return (
    <div>
      <TopNav title={t('admin.dashboard')} />

      <div className="px-5 pb-8">
        {/* Stats cards */}
        {statsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <Card className="text-center">
              <p className="text-2xl font-bold text-brand-600">{stats?.babysitterCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.babysitters')}</p>
            </Card>
            <Card className="text-center">
              <p className="text-2xl font-bold text-brand-600">{stats?.familyCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.families')}</p>
            </Card>
            <Card className="text-center">
              <p className="text-2xl font-bold text-brand-600">{stats?.appointmentCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.appointments')}</p>
            </Card>
            <Link to="/admin/verifications">
              <Card className={`text-center ${(stats?.pendingVerificationCount ?? 0) > 0 ? 'border-amber-300 bg-amber-50' : ''}`}>
                <p className={`text-2xl font-bold ${(stats?.pendingVerificationCount ?? 0) > 0 ? 'text-amber-600' : 'text-brand-600'}`}>{stats?.pendingVerificationCount ?? 0}</p>
                <p className="mt-1 text-xs text-gray-500">{t('admin.pendingVerifications')}</p>
              </Card>
            </Link>
          </div>
        )}

        {/* Navigation cards, grouped */}
        {navGroups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.title}</h2>
            <div className="space-y-3">
              {group.cards.map((card) => (
                <Link key={card.to} to={card.to} className="block">
                  <Card interactive>
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
                        {card.icon}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{card.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{card.description}</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
