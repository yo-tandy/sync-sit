import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { useAdminStore } from '@/stores/adminStore';

interface UserInfo {
  email: string;
  name: string;
  role: string;
}

function rolePrefix(role: string) {
  switch (role) {
    case 'admin': return 'A';
    case 'babysitter': return 'B';
    case 'parent': return 'P';
    default: return '?';
  }
}

function shortId(uid: string, info: UserInfo | null) {
  if (!uid) return '';
  if (uid === 'system') return 'system';
  const prefix = info ? rolePrefix(info.role) : '?';
  return `${prefix}:${uid.slice(0, 6)}`;
}

export function AdminAuditLogPage() {
  const { t, i18n } = useTranslation();
  const { auditLogs, auditLogsLoading, fetchAuditLogs } = useAdminStore();

  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<{ uid: string; info: UserInfo | null } | null>(null);

  useEffect(() => {
    fetchAuditLogs({
      action: actionFilter !== 'all' ? actionFilter : undefined,
    });
  }, [fetchAuditLogs, actionFilter]);

  // Client-side search by email, name, action, or user ID
  const filteredLogs = useMemo(() => {
    if (!search.trim()) return auditLogs;
    const q = search.toLowerCase();
    return auditLogs.filter((log: any) => {
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
    { value: 'export_user_data', label: 'export_user_data' },
  ];

  const formatTs = (ts: any) => {
    if (!ts) return '—';
    try {
      let d: Date;
      if (typeof ts === 'string') {
        d = new Date(ts);
      } else if (ts._seconds != null) {
        d = new Date(ts._seconds * 1000);
      } else if (ts.seconds != null) {
        d = new Date(ts.seconds * 1000);
      } else {
        d = new Date(ts);
      }
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const formatDetails = (details: any) => {
    if (!details || typeof details !== 'object') return '';
    const entries = Object.entries(details).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}=${v}`).join(', ');
  };

  const UserTag = ({ uid, info }: { uid: string; info: UserInfo | null }) => {
    if (!uid || uid === 'system') {
      return <span className="text-gray-400">system</span>;
    }
    return (
      <button
        type="button"
        className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 hover:bg-gray-200"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedUser({ uid, info });
        }}
      >
        {shortId(uid, info)}
      </button>
    );
  };

  return (
    <div>
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
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            {t('admin.noAuditLogs')}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredLogs.map((log: any) => {
              const details = formatDetails(log.details);
              return (
                <div key={log.id} className="flex flex-wrap items-center gap-x-1.5 py-2 text-xs">
                  <span className="text-gray-400">{formatTs(log.timestamp)}</span>
                  <UserTag uid={log.adminUserId} info={log.adminInfo} />
                  <span className="font-semibold text-gray-900">{log.action}</span>
                  {log.targetUserId && (
                    <>
                      <span className="text-gray-400">→</span>
                      <UserTag uid={log.targetUserId} info={log.targetInfo} />
                    </>
                  )}
                  {details && (
                    <span className="text-gray-400">({details})</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* User info dialog */}
      <Dialog open={!!selectedUser} onClose={() => setSelectedUser(null)}>
        {selectedUser && (
          <div>
            <h3 className="mb-3 text-lg font-semibold">{t('admin.userDetails')}</h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-gray-500">ID: </span>
                <span className="font-mono text-gray-700">{selectedUser.uid}</span>
              </p>
              {selectedUser.info ? (
                <>
                  <p>
                    <span className="font-medium text-gray-500">{t('admin.fullName')}: </span>
                    <span className="text-gray-900">{selectedUser.info.name || '—'}</span>
                  </p>
                  <p>
                    <span className="font-medium text-gray-500">Email: </span>
                    <span className="text-gray-900">{selectedUser.info.email || '—'}</span>
                  </p>
                  <p>
                    <span className="font-medium text-gray-500">Role: </span>
                    <span className="text-gray-900">{selectedUser.info.role || '—'}</span>
                  </p>
                </>
              ) : (
                <p className="text-gray-500">{t('admin.userNotFound')}</p>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
