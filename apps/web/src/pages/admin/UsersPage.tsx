import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { DownloadIcon } from '@/components/ui/Icons';
import { useAdminStore, wireTimestampToMillis, type AdminUserListItem } from '@/stores/adminStore';

export function AdminUsersPage() {
  const { t, i18n } = useTranslation();
  const {
    users,
    usersLoading,
    fetchUsers,
    blockUser,
    deactivateUser,
    deleteUser,
    resetUserPassword,
    exportUserData,
  } = useAdminStore();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', action: async () => {} });

  const loadUsers = useCallback(() => {
    fetchUsers({
      search: search || undefined,
      role: roleFilter !== 'all' ? roleFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    });
  }, [fetchUsers, search, roleFilter, statusFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const handleBlock = (uid: string, currentStatus: string) => {
    const isBlocked = currentStatus === 'blocked';
    setConfirmDialog({
      open: true,
      title: isBlocked ? t('admin.unblockUser') : t('admin.blockUser'),
      message: isBlocked
        ? t('admin.confirmUnblock')
        : t('admin.confirmBlock'),
      action: async () => {
        await blockUser(uid);
        loadUsers();
      },
    });
  };

  const handleDeactivate = (uid: string, searchable: boolean) => {
    setConfirmDialog({
      open: true,
      title: searchable ? t('admin.deactivate') : t('admin.activate'),
      message: searchable ? t('admin.confirmDeactivate') : t('admin.confirmActivate'),
      action: async () => {
        await deactivateUser(uid);
        loadUsers();
      },
    });
  };

  const handleDelete = (uid: string) => {
    setConfirmDialog({
      open: true,
      title: t('admin.deleteUser'),
      message: t('admin.confirmDelete'),
      action: async () => {
        await deleteUser(uid);
        loadUsers();
      },
    });
  };

  const handleResetPassword = (uid: string) => {
    setConfirmDialog({
      open: true,
      title: t('admin.resetPassword'),
      message: t('admin.confirmResetPassword'),
      action: async () => {
        await resetUserPassword(uid);
      },
    });
  };

  const handleExport = async (uid: string) => {
    try {
      const data = await exportUserData(uid);
      if (!data) {
        alert('No data returned');
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gdpr-export-${uid}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed';
      alert(message);
    }
  };

  const [confirming, setConfirming] = useState(false);
  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await confirmDialog.action();
    } finally {
      setConfirming(false);
      setConfirmDialog((prev) => ({ ...prev, open: false }));
    }
  };

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin': return 'red' as const;
      case 'babysitter': return 'blue' as const;
      case 'parent': return 'green' as const;
      default: return 'gray' as const;
    }
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active': return 'green' as const;
      case 'blocked': return 'red' as const;
      case 'deleted': return 'gray' as const;
      default: return 'gray' as const;
    }
  };

  const roleOptions = [
    { value: 'all', label: t('admin.allRoles') },
    { value: 'babysitter', label: t('admin.roleBabysitter') },
    { value: 'parent', label: t('admin.roleParent') },
    { value: 'admin', label: t('admin.roleAdmin') },
  ];

  const statusOptions = [
    { value: 'all', label: t('admin.allStatuses') },
    { value: 'active', label: t('admin.statusActive') },
    { value: 'blocked', label: t('admin.statusBlocked') },
    { value: 'deleted', label: t('admin.statusDeleted') },
  ];

  const formatCreated = (user: AdminUserListItem) => {
    const ms = wireTimestampToMillis(user.createdAt);
    if (ms === null) return '—';
    return new Date(ms).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const columns: DataTableColumn<AdminUserListItem>[] = [
    {
      key: 'name',
      header: t('admin.table.name'),
      sortValue: (u) => `${u.lastName} ${u.firstName}`.toLowerCase(),
      render: (u) => (
        <div>
          <p className="font-semibold text-gray-900">
            {u.firstName} {u.lastName}
          </p>
          <p className="text-xs text-gray-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('admin.table.role'),
      sortValue: (u) => u.role,
      render: (u) => <Badge variant={roleBadgeVariant(u.role)}>{u.role}</Badge>,
    },
    {
      key: 'status',
      header: t('admin.table.status'),
      sortValue: (u) => (u.role === 'babysitter' ? (u.searchable ? 'active' : 'inactive') : u.status),
      render: (u) =>
        u.role === 'babysitter' ? (
          <Badge variant={u.searchable ? 'green' : 'gray'}>
            {u.searchable ? t('admin.active') : t('admin.inactive')}
          </Badge>
        ) : (
          // In a table, an empty cell under a header reads as missing data
          // (unlike a card, where no badge meant "normal") — show the
          // unremarkable state as muted text instead.
          u.status !== 'active' ? (
            <Badge variant={statusBadgeVariant(u.status)}>{u.status}</Badge>
          ) : (
            <span className="text-gray-500">{u.status}</span>
          )
        ),
    },
    {
      key: 'created',
      header: t('admin.table.created'),
      sortValue: (u) => wireTimestampToMillis(u.createdAt),
      render: formatCreated,
    },
    {
      key: 'actions',
      header: t('admin.table.actions'),
      className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => handleBlock(u.uid, u.status)}>
            {u.status === 'blocked' ? t('admin.unblock') : t('admin.block')}
          </Button>
          {u.role === 'babysitter' && (
            <Button variant="outline" size="sm" onClick={() => handleDeactivate(u.uid, u.searchable === true)}>
              {u.searchable ? t('admin.deactivate') : t('admin.activate')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleDelete(u.uid)}>
            {t('admin.delete')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleResetPassword(u.uid)}>
            {t('admin.resetPwd')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport(u.uid)}>
            <DownloadIcon className="h-4 w-4" />
            {t('admin.exportData')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <TopNav title={t('admin.manageUsers')} backTo="/admin" />

      <div className="px-5 pb-8">
        {/* Filters */}
        <Input
          placeholder={t('admin.searchUsers')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            options={roleOptions}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          />
          <Select
            options={statusOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>

        {/* User list */}
        {usersLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={users}
            rowKey={(u) => u.uid}
            emptyLabel={t('admin.noUsersFound')}
            initialSort={{ key: 'name', dir: 'asc' }}
          />
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}>
        <h3 className="mb-2 text-lg font-semibold">{confirmDialog.title}</h3>
        <p className="mb-6 text-sm text-gray-600">{confirmDialog.message}</p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleConfirm}>
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
