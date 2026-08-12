import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
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

  return (
    <div>
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
        ) : families.length === 0 && !familiesError ? (
          <p className="py-8 text-center text-sm text-gray-500">
            {t('admin.familiesPage.empty')}
          </p>
        ) : (
          <div className="space-y-3">
            {families.map((family) => (
              <Card key={family.familyId}>
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{family.familyName}</p>
                    <p className="text-xs text-gray-500">{family.address}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={family.verified ? 'green' : 'gray'}>
                      {family.verified
                        ? t('admin.familiesPage.verified')
                        : t('admin.familiesPage.notVerified')}
                    </Badge>
                    {family.status !== 'active' && (
                      <Badge variant="gray">{family.status}</Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-0.5">
                  {family.parents.map((p) => (
                    <p key={p.uid} className="text-xs text-gray-600">
                      {parentName(p)} · {p.email}
                    </p>
                  ))}
                </div>

                {family.kids.length > 0 && (
                  <p className="mt-2 text-xs text-gray-600">
                    {t('admin.familiesPage.kidsSummary', {
                      count: family.kidsCount,
                      list: kidsSummary(family),
                    })}
                  </p>
                )}
                {family.governedKidsCount > 0 && (
                  <p className="mt-0.5 text-xs text-gray-600">
                    {t('admin.familiesPage.governedKids', { count: family.governedKidsCount })}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {t('admin.familiesPage.registered', { date: formatIso(family.createdAt) })}
                </p>

                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [family.familyId]: !prev[family.familyId],
                      }))
                    }
                  >
                    {expanded[family.familyId]
                      ? t('admin.familiesPage.hideDetails')
                      : t('admin.familiesPage.details')}
                  </Button>
                </div>

                {expanded[family.familyId] && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-gray-700">
                      {t('admin.familiesPage.parents')}
                    </p>
                    {family.parents.map((p) => (
                      <div key={p.uid} className="flex items-center justify-between py-1">
                        <span className="text-xs text-gray-700">
                          {parentName(p)} · {p.email}
                        </span>
                        <Badge variant={parentStatusVariant(p.status)}>{p.status ?? '—'}</Badge>
                      </div>
                    ))}
                    <p className="mt-2 text-xs text-gray-600">
                      {t('admin.familiesPage.preferredCount', { count: family.preferredCount })}
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
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
