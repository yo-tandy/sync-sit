import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { useAdminStore, type AdminFamilyParent, type AdminFamilyRow } from '@/stores/adminStore';

export function AdminFamiliesPage() {
  const { t, i18n } = useTranslation();
  const {
    families,
    familiesLoading,
    familiesLoadingMore,
    familiesHasMore,
    familiesError,
    fetchFamilies,
  } = useAdminStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const currentParams = useCallback(
    () => ({
      search: search || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      verified: verifiedFilter === 'all' ? undefined : verifiedFilter === 'verified',
    }),
    [search, statusFilter, verifiedFilter],
  );

  const loadFamilies = useCallback(() => {
    fetchFamilies(currentParams());
  }, [fetchFamilies, currentParams]);

  // Debounced search (same as UsersPage; also performs the initial fetch)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadFamilies();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadFamilies]);

  const handleLoadMore = () => {
    const last = families[families.length - 1];
    if (!last) return;
    fetchFamilies({ ...currentParams(), startAfterId: last.familyId });
  };

  const formatIso = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const parentName = (p: AdminFamilyParent) =>
    [p.firstName, p.lastName].filter(Boolean).join(' ');

  const kidsSummary = (family: AdminFamilyRow) =>
    family.kids.map((k) => `${k.firstName} (${k.age})`).join(', ');

  const parentStatusVariant = (status: string | null) => {
    switch (status) {
      case 'active': return 'green' as const;
      case 'blocked': return 'red' as const;
      default: return 'gray' as const;
    }
  };

  const statusOptions = [
    { value: 'all', label: t('admin.allStatuses') },
    { value: 'active', label: t('admin.statusActive') },
    { value: 'deleted', label: t('admin.statusDeleted') },
  ];

  const verifiedOptions = [
    { value: 'all', label: t('admin.familiesPage.allVerification') },
    { value: 'verified', label: t('admin.familiesPage.verified') },
    { value: 'unverified', label: t('admin.familiesPage.notVerified') },
  ];

  const columns: DataTableColumn<AdminFamilyRow>[] = [
    {
      key: 'name',
      header: t('admin.table.name'),
      sortValue: (f) => f.familyName.toLowerCase(),
      render: (f) => (
        <div>
          <p className="font-semibold text-gray-900">{f.familyName}</p>
          <p className="text-xs text-gray-500">{f.address}</p>
        </div>
      ),
    },
    {
      key: 'parents',
      header: t('admin.familiesPage.parents'),
      render: (f) => (
        <div>
          <div className="space-y-0.5">
            {f.parents.map((p) => (
              <p key={p.uid} className="text-xs text-gray-600">
                {parentName(p)} · {p.email}
              </p>
            ))}
          </div>
          {expanded[f.familyId] && (
            <div className="mt-2 rounded-lg bg-gray-50 p-3">
              {f.parents.map((p) => (
                <div key={p.uid} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-gray-700">
                    {parentName(p)} · {p.email}
                  </span>
                  <Badge variant={parentStatusVariant(p.status)}>{p.status ?? '—'}</Badge>
                </div>
              ))}
              <p className="mt-2 text-xs text-gray-600">
                {t('admin.familiesPage.preferredCount', { count: f.preferredCount })}
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'kids',
      header: t('admin.table.kids'),
      sortValue: (f) => f.kidsCount,
      render: (f) => (
        <div>
          {f.kids.length > 0 && (
            <p className="text-xs text-gray-600">
              {t('admin.familiesPage.kidsSummary', { count: f.kidsCount, list: kidsSummary(f) })}
            </p>
          )}
          {f.governedKidsCount > 0 && (
            <p className="mt-0.5 text-xs text-gray-600">
              {t('admin.familiesPage.governedKids', { count: f.governedKidsCount })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'verified',
      header: t('admin.familiesPage.verifiedLabel'),
      sortValue: (f) => (f.verified ? 1 : 0),
      render: (f) => (
        <Badge variant={f.verified ? 'green' : 'gray'}>
          {f.verified ? t('admin.familiesPage.verified') : t('admin.familiesPage.notVerified')}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('admin.table.status'),
      sortValue: (f) => f.status,
      // Empty table cells read as missing data — muted text for the
      // unremarkable majority state (cards could omit the badge; tables can't).
      render: (f) =>
        f.status !== 'active' ? (
          <Badge variant="gray">{f.status}</Badge>
        ) : (
          <span className="text-gray-500">{f.status}</span>
        ),
    },
    {
      key: 'created',
      header: t('admin.table.created'),
      sortValue: (f) => f.createdAt,
      render: (f) => formatIso(f.createdAt) || '—',
    },
    {
      key: 'actions',
      header: t('admin.table.actions'),
      className: 'text-right',
      render: (f) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setExpanded((prev) => ({
              ...prev,
              [f.familyId]: !prev[f.familyId],
            }))
          }
        >
          {expanded[f.familyId] ? t('admin.familiesPage.hideDetails') : t('admin.familiesPage.details')}
        </Button>
      ),
    },
  ];

  return (
    // Wide desktop tier (issue #119): the DataTable wants the 5xl cap.
    <div data-page-width="wide">
      <TopNav title={t('admin.familiesPage.title')} backTo="/admin" />

      <div className="px-5 pb-8">
        {/* Filters */}
        <Input
          placeholder={t('admin.familiesPage.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            aria-label={t('admin.familiesPage.statusLabel')}
            options={statusOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
          <Select
            aria-label={t('admin.familiesPage.verifiedLabel')}
            options={verifiedOptions}
            value={verifiedFilter}
            onChange={(e) => setVerifiedFilter(e.target.value)}
          />
        </div>

        {/* Family list */}
        {familiesLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : families.length === 0 && familiesError ? null : (
          <DataTable
            columns={columns}
            rows={families}
            rowKey={(f) => f.familyId}
            emptyLabel={t('admin.familiesPage.empty')}
            initialSort={{ key: 'name', dir: 'asc' }}
          />
        )}

        {/* Load failure: distinguishable from a genuinely empty result */}
        {familiesError && (
          <p className="mt-4 text-center text-sm text-brand-600" role="alert">
            {t('admin.familiesPage.loadError')}
          </p>
        )}

        {/* Paging */}
        {!familiesLoading && familiesHasMore && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={familiesLoadingMore}>
              {t('admin.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
