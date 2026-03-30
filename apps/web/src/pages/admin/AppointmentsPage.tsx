import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { TrashIcon } from '@/components/ui/Icons';
import { useAdminStore } from '@/stores/adminStore';

export function AdminAppointmentsPage() {
  const { t, i18n } = useTranslation();
  const {
    appointments,
    appointmentsLoading,
    fetchAppointments,
    deleteAppointment,
  } = useAdminStore();

  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchAppointments({
      status: statusFilter !== 'all' ? statusFilter : undefined,
    });
  }, [fetchAppointments, statusFilter]);

  // Client-side search filtering
  const filteredAppointments = useMemo(() => {
    if (!search.trim()) return appointments;
    const q = search.toLowerCase();
    return appointments.filter((appt: any) => {
      const babysitter = (appt.babysitterName || '').toLowerCase();
      const family = (appt.familyName || '').toLowerCase();
      const parents = (appt.parentNames || '').toLowerCase();
      const date = (appt.date || '').toLowerCase();
      return babysitter.includes(q) || family.includes(q) || parents.includes(q) || date.includes(q);
    });
  }, [appointments, search]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteAppointment(deleteTarget);
    setDeleteTarget(null);
    fetchAppointments({
      status: statusFilter !== 'all' ? statusFilter : undefined,
    });
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'confirmed': return 'green' as const;
      case 'pending': return 'amber' as const;
      case 'cancelled': return 'gray' as const;
      case 'completed': return 'blue' as const;
      default: return 'gray' as const;
    }
  };

  const statusOptions = [
    { value: 'all', label: t('admin.allStatuses') },
    { value: 'pending', label: t('admin.statusPending') },
    { value: 'confirmed', label: t('admin.statusConfirmed') },
    { value: 'completed', label: t('admin.statusCompleted') },
    { value: 'cancelled', label: t('admin.statusCancelled') },
  ];

  const formatAppointmentDate = (appt: any) => {
    if (appt.date) {
      const parts = [appt.date];
      if (appt.startTime) parts.push(appt.startTime);
      if (appt.endTime) parts.push('–', appt.endTime);
      return parts.join(' ');
    }
    return appt.type === 'recurring' ? t('admin.recurring') : '—';
  };

  return (
    <div>
      <TopNav title={t('admin.manageAppointments')} backTo="/admin" />

      <div className="px-5 pb-8">
        <Input
          placeholder={t('admin.searchAppointments')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />

        {appointmentsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : filteredAppointments.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            {t('admin.noAppointmentsFound')}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredAppointments.map((appt: any) => (
              <Card key={appt.id}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {appt.babysitterName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t('admin.family')}: {appt.familyName}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatAppointmentDate(appt)}
                    </p>
                    {appt.offeredRate != null && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {appt.offeredRate}€/h
                      </p>
                    )}
                  </div>
                  <Badge variant={statusBadgeVariant(appt.status)}>
                    {appt.status}
                  </Badge>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-auto"
                    onClick={() => setDeleteTarget(appt.id)}
                  >
                    <TrashIcon className="h-4 w-4" />
                    {t('admin.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <h3 className="mb-2 text-lg font-semibold">{t('admin.deleteAppointment')}</h3>
        <p className="mb-6 text-sm text-gray-600">{t('admin.confirmDeleteAppointment')}</p>
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleDelete}>
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
