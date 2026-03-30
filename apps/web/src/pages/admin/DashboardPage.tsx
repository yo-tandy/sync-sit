import { useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { UsersIcon, CalendarIcon, ClipboardListIcon, DownloadIcon } from '@/components/ui/Icons';
import { useAdminStore } from '@/stores/adminStore';

export function AdminDashboard() {
  const { t } = useTranslation();
  const { stats, statsLoading, fetchStats } = useAdminStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const navCards = [
    {
      to: '/admin/users',
      icon: <UsersIcon className="h-6 w-6 text-red-600" />,
      title: t('admin.manageUsers'),
      description: t('admin.manageUsersDesc'),
    },
    {
      to: '/admin/appointments',
      icon: <CalendarIcon className="h-6 w-6 text-red-600" />,
      title: t('admin.manageAppointments'),
      description: t('admin.manageAppointmentsDesc'),
    },
    {
      to: '/admin/holidays',
      icon: <CalendarIcon className="h-6 w-6 text-red-600" />,
      title: t('admin.holidays'),
      description: t('admin.holidaysDesc'),
    },
    {
      to: '/admin/audit-log',
      icon: <ClipboardListIcon className="h-6 w-6 text-red-600" />,
      title: t('admin.auditLog'),
      description: t('admin.auditLogDesc'),
    },
    {
      to: '/admin/gdpr-export',
      icon: <DownloadIcon className="h-6 w-6 text-red-600" />,
      title: t('admin.gdprExport'),
      description: t('admin.gdprExportDesc'),
    },
  ];

  return (
    <div>
      <TopNav title={t('admin.dashboard')} />

      <div className="px-5 pb-8">
        {/* Stats cards */}
        {statsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Card className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats?.babysitterCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.babysitters')}</p>
            </Card>
            <Card className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats?.familyCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.families')}</p>
            </Card>
            <Card className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats?.appointmentCount ?? 0}</p>
              <p className="mt-1 text-xs text-gray-500">{t('admin.appointments')}</p>
            </Card>
          </div>
        )}

        {/* Navigation cards */}
        <div className="space-y-3">
          {navCards.map((card) => (
            <Link key={card.to} to={card.to} className="block">
              <Card interactive>
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
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
      </div>
    </div>
  );
}
