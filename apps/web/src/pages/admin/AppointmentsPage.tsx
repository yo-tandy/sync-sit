import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { TrashIcon } from '@/components/ui/Icons';
import { useAdminStore, type AdminAppointmentListItem } from '@/stores/adminStore';

export function AdminAppointmentsPage() {
  const { t } = useTranslation();
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
    return appointments.filter((appt) => {
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

  const columns: DataTableColumn<AdminAppointmentListItem>[] = [
    {
      key: 'date',
      header: t('admin.table.date'),
      sortValue: (a) => a.date ?? null,
      render: (a) => a.date ?? (a.type === 'recurring' ? t('admin.recurring') : '—'),
    },
    {
      key: 'time',
      header: t('admin.table.time'),
      render: (a) => (a.startTime ? `${a.startTime}–${a.endTime ?? ''}` : '—'),
    },
    {
      key: 'babysitter',
      header: t('admin.table.babysitter'),
      sortValue: (a) => a.babysitterName?.toLowerCase() ?? null,
      render: (a) => a.babysitterName ?? '—',
    },
    {
      key: 'family',
      header: t('admin.table.family'),
      sortValue: (a) => (a.familyName ?? a.parentNames)?.toLowerCase() ?? null,
      render: (a) => a.familyName ?? a.parentNames ?? '—',
    },
    {
      key: 'type',
      header: t('admin.table.type'),
      sortValue: (a) => a.type ?? null,
      render: (a) => a.type ?? '—',
    },
    {
      key: 'status',
      header: t('admin.table.status'),
      sortValue: (a) => a.status,
      render: (a) => <Badge variant={statusBadgeVariant(a.status)}>{a.status}</Badge>,
    },
    {
      key: 'rate',
      header: t('admin.table.rate'),
      className: 'text-right',
      sortValue: (a) => a.offeredRate ?? null,
      render: (a) => (a.offeredRate != null ? `${a.offeredRate}€/h` : '—'),
    },
    {
      key: 'actions',
      header: t('admin.table.actions'),
      className: 'text-right',
      render: (a) => (
        <Button variant="outline" size="sm" fullWidth={false} onClick={() => setDeleteTarget(a.id)}>
          <TrashIcon className="h-4 w-4" />
          {t('admin.delete')}
        </Button>
      ),
    },
  ];

  return (
    // Wide desktop tier (issue #119): the DataTable wants the 5xl cap.
    <div data-page-width="wide">
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
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={filteredAppointments}
            rowKey={(a) => a.id}
            emptyLabel={t('admin.noAppointmentsFound')}
            initialSort={{ key: 'date', dir: 'desc' }}
          />
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} ariaLabel={t('admin.deleteAppointment')}>
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
