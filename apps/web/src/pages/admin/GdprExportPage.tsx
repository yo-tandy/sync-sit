import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { DownloadIcon } from '@/components/ui/Icons';
import { useAdminStore } from '@/stores/adminStore';

export function AdminGdprExportPage() {
  const { t } = useTranslation();
  const { users, usersLoading, fetchUsers, exportUserData, exporting } = useAdminStore();

  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<{
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null>(null);

  const loadUsers = useCallback(() => {
    if (search.length >= 2) {
      fetchUsers({ search });
    }
  }, [fetchUsers, search]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const handleExport = async () => {
    if (!selectedUser) return;
    const data = await exportUserData(selectedUser.uid);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gdpr-export-${selectedUser.uid}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <TopNav title={t('admin.gdprExport')} backTo="/admin" />

      <div className="px-5 pb-8">
        <Input
          placeholder={t('admin.searchUsersToExport')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedUser(null);
          }}
        />

        {/* Selected user card */}
        {selectedUser && (
          <Card className="mb-4 border-red-200 bg-red-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {selectedUser.firstName} {selectedUser.lastName}
                </p>
                <p className="text-xs text-gray-500">{selectedUser.email}</p>
              </div>
              <Button
                variant="primary"
                size="sm"
                className="w-auto"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <>
                    <DownloadIcon className="h-4 w-4" />
                    {t('admin.exportData')}
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Search results */}
        {!selectedUser && search.length >= 2 && (
          <>
            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-8 w-8 text-red-600" />
              </div>
            ) : users.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                {t('admin.noUsersFound')}
              </p>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <Card
                    key={user.uid}
                    interactive
                    onClick={() =>
                      setSelectedUser({
                        uid: user.uid,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                      })
                    }
                  >
                    <p className="text-sm font-semibold text-gray-900">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {!selectedUser && search.length < 2 && (
          <p className="py-8 text-center text-sm text-gray-400">
            {t('admin.typeToSearch')}
          </p>
        )}
      </div>
    </div>
  );
}
