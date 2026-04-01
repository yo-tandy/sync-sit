import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { DownloadIcon } from '@/components/ui/Icons';
import { useAdminStore } from '@/stores/adminStore';

export function AdminUsersPage() {
  const { t } = useTranslation();
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
    } catch (err: any) {
      alert(err.message || 'Export failed');
    }
  };

  const handleConfirm = async () => {
    await confirmDialog.action();
    setConfirmDialog((prev) => ({ ...prev, open: false }));
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
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">{t('admin.noUsersFound')}</p>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <Card key={user.uid}>
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
                    {user.role === 'babysitter' ? (
                      <Badge variant={user.searchable ? 'green' : 'gray'}>
                        {user.searchable ? t('admin.active') : t('admin.inactive')}
                      </Badge>
                    ) : (
                      user.status !== 'active' && (
                        <Badge variant={statusBadgeVariant(user.status)}>{user.status}</Badge>
                      )
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-5 gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleBlock(user.uid, user.status)}>
                    {user.status === 'blocked' ? t('admin.unblock') : t('admin.block')}
                  </Button>
                  {user.role === 'babysitter' ? (
                    <Button variant="outline" size="sm" onClick={() => handleDeactivate(user.uid, user.searchable === true)}>
                      {user.searchable ? t('admin.deactivate') : t('admin.activate')}
                    </Button>
                  ) : (
                    <div />
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleDelete(user.uid)}>
                    {t('admin.delete')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleResetPassword(user.uid)}>
                    {t('admin.resetPwd')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExport(user.uid)}>
                    <DownloadIcon className="h-4 w-4" />
                    {t('admin.exportData')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
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
