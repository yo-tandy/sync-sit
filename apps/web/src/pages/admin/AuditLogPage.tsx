import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  useAdminStore,
  wireTimestampToMillis,
  type AdminAuditLogEntry,
  type WireTimestamp,
} from '@/stores/adminStore';

export function AdminAuditLogPage() {
  const { t, i18n } = useTranslation();
  const { auditLogs, auditLogsLoading, fetchAuditLogs } = useAdminStore();

  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchAuditLogs({
      action: actionFilter !== 'all' ? actionFilter : undefined,
    });
  }, [fetchAuditLogs, actionFilter]);

  // Client-side search by email, name, action, or user ID
  const filteredLogs = useMemo(() => {
    if (!search.trim()) return auditLogs;
    const q = search.toLowerCase();
    return auditLogs.filter((log) => {
      const adminEmail = (log.adminInfo?.email || '').toLowerCase();
      const adminName = (log.adminInfo?.name || '').toLowerCase();
      const targetEmail = (log.targetInfo?.email || '').toLowerCase();
      const targetName = (log.targetInfo?.name || '').toLowerCase();
      const action = (log.action || '').toLowerCase();
      const adminId = (log.adminUserId || '').toLowerCase();
      const targetId = (log.targetUserId || '').toLowerCase();
      return adminEmail.includes(q) || adminName.includes(q) ||
        targetEmail.includes(q) || targetName.includes(q) ||
        action.includes(q) || adminId.includes(q) || targetId.includes(q);
    });
  }, [auditLogs, search]);

  const actionOptions = [
    { value: 'all', label: t('admin.allActions') },
    { value: 'babysitter_enrolled', label: 'babysitter_enrolled' },
    { value: 'family_enrolled', label: 'family_enrolled' },
    { value: 'joined_family', label: 'joined_family' },
    { value: 'search_babysitters', label: 'search_babysitters' },
    { value: 'contact_request_sent', label: 'contact_request_sent' },
    { value: 'appointment_accepted', label: 'appointment_accepted' },
    { value: 'appointment_declined', label: 'appointment_declined' },
    { value: 'block_user', label: 'block_user' },
    { value: 'unblock_user', label: 'unblock_user' },
    { value: 'delete_user', label: 'delete_user' },
    { value: 'deactivate_user', label: 'deactivate_user' },
    { value: 'activate_user', label: 'activate_user' },
    { value: 'reset_password', label: 'reset_password' },
    { value: 'delete_appointment', label: 'delete_appointment' },
    { value: 'update_holidays', label: 'update_holidays' },
    { value: 'admin_config_updated', label: t('admin.config.title') },
    { value: 'export_user_data', label: 'export_user_data' },
    { value: 'user_identity_corrected', label: 'user_identity_corrected' },
  ];

  const formatTs = (ts: WireTimestamp | null | undefined) => {
    const ms = wireTimestampToMillis(ts);
    if (ms === null) return '—';
    return new Date(ms).toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDetails = (details: Record<string, unknown> | null | undefined) => {
    if (!details || typeof details !== 'object') return '';
    const entries = Object.entries(details).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return '';
    // Object values (e.g. the {before, after} payloads of identity
    // corrections) would otherwise render as "[object Object]", hiding
    // exactly the values the audit entry exists to show.
    return entries
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
  };

  const columns: DataTableColumn<AdminAuditLogEntry>[] = [
    {
      key: 'timestamp',
      header: t('admin.table.timestamp'),
      sortValue: (l) => wireTimestampToMillis(l.timestamp),
      render: (l) => <span className="text-xs text-gray-500">{formatTs(l.timestamp)}</span>,
    },
    {
      key: 'admin',
      header: t('admin.table.admin'),
      render: (l) => (
        <div>
          <p className="text-xs text-gray-700">{l.adminInfo?.name || l.adminUserId}</p>
          {l.adminInfo?.email && <p className="text-xs text-gray-500">{l.adminInfo.email}</p>}
        </div>
      ),
    },
    {
      key: 'action',
      header: t('admin.table.action'),
      sortValue: (l) => l.action,
      render: (l) => <span className="text-xs font-semibold text-gray-900">{l.action}</span>,
    },
    {
      key: 'target',
      header: t('admin.table.target'),
      render: (l) => (
        <span className="text-xs text-gray-700">{l.targetInfo?.name || l.targetUserId || '—'}</span>
      ),
    },
    {
      key: 'details',
      header: t('admin.table.details'),
      render: (l) => {
        const details = formatDetails(l.details);
        return details ? <span className="text-xs text-gray-500">{details}</span> : null;
      },
    },
  ];

  return (
    // Wide desktop tier (issue #119): the DataTable wants the 5xl cap.
    <div data-page-width="wide">
      <TopNav title={t('admin.auditLog')} backTo="/admin" />

      <div className="px-5 pb-8">
        <Input
          placeholder={t('admin.searchAuditLog')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          options={actionOptions}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />

        {auditLogsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={filteredLogs}
            rowKey={(l) => l.id}
            emptyLabel={t('admin.noAuditLogs')}
            initialSort={{ key: 'timestamp', dir: 'desc' }}
          />
        )}
      </div>
    </div>
  );
}
