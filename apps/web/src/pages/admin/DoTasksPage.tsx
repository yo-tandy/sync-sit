import { useEffect, useState, useCallback, useRef } from 'react';
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
import {
  useAdminStore,
  wireTimestampToMillis,
  type AdminDoTaskRow,
  type AdminDoOfferRow,
} from '@/stores/adminStore';

/**
 * The sync-do Tasks tab (plan §9.4). Admin lives ONLY in `apps/web` —
 * `apps/study-web` has no admin tree and sync-do grows none either, so the
 * existing panel is extended rather than duplicated.
 *
 * Decision 20 is untouched by this page: it is reachable only under
 * `AdminLayout`'s `<AuthGuard role="admin">`, and no sync-do link, switcher
 * entry or promo is added anywhere a member can see. Admin tooling is not a
 * sync-do entry point.
 *
 * Filters mirror FamiliesPage exactly: debounced free-text `Input`, `Select`
 * dropdowns whose 'all' option maps back to `undefined`, a `DataTable`, an
 * error banner distinguishable from the empty state, and cursor paging.
 * The offers view is an in-row expansion (the Families precedent), fetched
 * on demand rather than joined into every list row — a task's offers carry
 * the +1 helper's name and age (§11.3), and there is no reason to ship that
 * for fifty rows to read one.
 */

/** The seven §5 categories, as `TaskCategory` values. Duplicated as string
 *  literals rather than imported: `apps/web` has no `@ejm/do-core`
 *  dependency and adding one for a filter dropdown would pull the whole
 *  taxonomy (with its EN+FR considerations content) into the sit bundle. */
const DO_CATEGORIES = [
  'green_thumb',
  'boxes',
  'ikea',
  'party',
  'it',
  'errands',
  'pet_house',
] as const;

const DO_STATUSES = ['open', 'assigned', 'completed', 'cancelled'] as const;

export function AdminDoTasksPage() {
  const { t, i18n } = useTranslation();
  const {
    doTasks,
    doTasksLoading,
    doTasksLoadingMore,
    doTasksHasMore,
    doTasksError,
    doTasksTruncated,
    fetchDoTasks,
    fetchDoTaskOffers,
    deleteDoTask,
  } = useAdminStore();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [familyFilter, setFamilyFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [offers, setOffers] = useState<AdminDoOfferRow[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminDoTaskRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const currentParams = useCallback(
    () => ({
      search: search || undefined,
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      familyId: familyFilter.trim() || undefined,
    }),
    [search, categoryFilter, statusFilter, familyFilter],
  );

  const loadTasks = useCallback(() => {
    fetchDoTasks(currentParams());
  }, [fetchDoTasks, currentParams]);

  // Debounced search; also performs the initial fetch (the Families idiom).
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTasks();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadTasks]);

  const handleLoadMore = () => {
    const last = doTasks[doTasks.length - 1];
    if (!last) return;
    fetchDoTasks({ ...currentParams(), startAfterId: last.id });
  };

  // Generation guard (the BoardPage shape): expanding row A then row B
  // before A's callable resolves would otherwise render A's offers under B —
  // including the §11.3 helper's name and age attributed to the wrong task,
  // and B's spinner cleared early. Both callables are fast, so the window is
  // narrow; the mis-attribution is also exactly the kind nobody notices in a
  // support context, which is what makes it worth a guard rather than a
  // comment. Captured at call time, checked before every state write.
  const offersRequestRef = useRef(0);

  const toggleOffers = async (task: AdminDoTaskRow) => {
    if (expandedId === task.id) {
      setExpandedId(null);
      return;
    }
    const generation = ++offersRequestRef.current;
    setExpandedId(task.id);
    setOffers([]);
    setOffersError(false);
    setOffersLoading(true);
    try {
      const rows = await fetchDoTaskOffers(task.id);
      if (offersRequestRef.current !== generation) return;
      setOffers(rows);
    } catch {
      if (offersRequestRef.current !== generation) return;
      setOffersError(true);
    } finally {
      // Guarded too: a stale request must not clear the CURRENT row's
      // spinner, which would render "no offers" over a live fetch.
      if (offersRequestRef.current === generation) setOffersLoading(false);
    }
  };

  // The dialog closes only on SUCCESS. `deleteDoTask` rethrows (unlike the
  // list fetch, which flags an error instead), and a `finally`-only close
  // would look identical to a success while the row stayed put — on the one
  // action in this panel that also deletes files. So a failure keeps the
  // dialog open and shows the reason.
  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteDoTask(deleteTarget.id);
      if (expandedId === deleteTarget.id) setExpandedId(null);
      setDeleteTarget(null);
      loadTasks();
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (ts: AdminDoTaskRow['createdAt']): string => {
    const ms = wireTimestampToMillis(ts);
    if (ms === null) return '—';
    return new Date(ms).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const statusVariant = (status: string) => {
    switch (status) {
      case 'open': return 'green' as const;
      case 'assigned': return 'blue' as const;
      case 'completed': return 'gray' as const;
      case 'cancelled': return 'red' as const;
      default: return 'gray' as const;
    }
  };

  const categoryOptions = [
    { value: 'all', label: t('admin.doTasks.allCategories') },
    ...DO_CATEGORIES.map((c) => ({ value: c, label: t(`admin.doTasks.category.${c}`) })),
  ];

  const statusOptions = [
    { value: 'all', label: t('admin.allStatuses') },
    ...DO_STATUSES.map((s) => ({ value: s, label: t(`admin.doTasks.status.${s}`) })),
  ];

  const columns: DataTableColumn<AdminDoTaskRow>[] = [
    {
      key: 'title',
      header: t('admin.doTasks.taskLabel'),
      sortValue: (task) => task.title.toLowerCase(),
      render: (task) => (
        <div>
          <p className="font-semibold text-gray-900">{task.title}</p>
          <p className="text-xs text-gray-500">
            {t(`admin.doTasks.category.${task.category}`, { defaultValue: task.category })}
            {' · '}
            {task.areaLabel || '—'}
          </p>
          {expandedId === task.id && (
            <div className="mt-2 rounded-lg bg-gray-50 p-3">
              <p className="whitespace-pre-line text-xs text-gray-700">{task.description}</p>
              <p className="mt-2 text-xs text-gray-500">
                {t('admin.doTasks.taskId', { id: task.id })}
                {task.photoCount > 0 &&
                  ` · ${t('admin.doTasks.photoCount', { count: task.photoCount })}`}
              </p>

              <p className="mt-3 text-xs font-semibold text-gray-700">
                {t('admin.doTasks.offersTitle')}
              </p>
              {offersLoading ? (
                <div className="flex justify-center py-3">
                  <Spinner className="h-5 w-5 text-brand-600" />
                </div>
              ) : offersError ? (
                <p className="mt-1 text-xs text-brand-600" role="alert">
                  {t('admin.doTasks.offersError')}
                </p>
              ) : offers.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">{t('admin.doTasks.noOffers')}</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {offers.map((offer) => (
                    <li key={offer.id} className="border-t border-gray-200 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-800">
                          {offer.doerFirstName || offer.doerUserId}
                          {offer.price !== null &&
                            ` · ${t('admin.doTasks.offerPrice', {
                              price: offer.price,
                              basis: t(`admin.doTasks.basis.${offer.priceBasis ?? 'flat'}`, {
                                defaultValue: offer.priceBasis ?? '',
                              }),
                            })}`}
                        </span>
                        <Badge variant="gray">{offer.status}</Badge>
                      </div>
                      {offer.message && (
                        <p className="mt-1 whitespace-pre-line text-xs text-gray-600">
                          {offer.message}
                        </p>
                      )}
                      {offer.helper && (
                        <p className="mt-1 text-xs text-amber-700">
                          {t('admin.doTasks.helper', {
                            name: `${offer.helper.firstName} ${offer.helper.lastName}`,
                            age: offer.helper.age,
                          })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'family',
      header: t('admin.table.family'),
      sortValue: (task) => task.familyName.toLowerCase(),
      render: (task) => (
        <div>
          <p className="text-xs text-gray-700">{task.familyName || '—'}</p>
          <p className="text-xs text-gray-500">{task.familyId}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.table.status'),
      sortValue: (task) => task.status,
      render: (task) => <Badge variant={statusVariant(task.status)}>{task.status}</Badge>,
    },
    {
      key: 'offers',
      header: t('admin.doTasks.offersLabel'),
      sortValue: (task) => task.offerCount,
      render: (task) => <span className="text-gray-700">{task.offerCount}</span>,
    },
    {
      key: 'created',
      header: t('admin.table.created'),
      sortValue: (task) => wireTimestampToMillis(task.createdAt),
      render: (task) => formatDate(task.createdAt),
    },
    {
      key: 'actions',
      header: t('admin.table.actions'),
      className: 'text-right',
      render: (task) => (
        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            fullWidth={false}
            onClick={() => toggleOffers(task)}
          >
            {expandedId === task.id
              ? t('admin.doTasks.hideDetails')
              : t('admin.doTasks.details')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            fullWidth={false}
            onClick={() => setDeleteTarget(task)}
          >
            <TrashIcon className="h-4 w-4" />
            {t('admin.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    // Wide desktop tier (issue #119): the DataTable wants the 5xl cap.
    <div data-page-width="wide">
      <TopNav title={t('admin.doTasks.title')} backTo="/admin" />

      <div className="px-5 pb-8">
        <Input
          placeholder={t('admin.doTasks.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            aria-label={t('admin.doTasks.categoryLabel')}
            options={categoryOptions}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
          <Select
            aria-label={t('admin.table.status')}
            options={statusOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
        <Input
          placeholder={t('admin.doTasks.familyFilter')}
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        />

        {doTasksLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : doTasks.length === 0 && doTasksError ? null : (
          <DataTable
            columns={columns}
            rows={doTasks}
            rowKey={(task) => task.id}
            emptyLabel={t('admin.doTasks.empty')}
            initialSort={{ key: 'created', dir: 'desc' }}
          />
        )}

        {/* The search window filled before the filter ran, so "no match" is
            not a definitive answer — say so rather than let a silent miss
            read as "this task does not exist". */}
        {!doTasksLoading && doTasksTruncated && (
          <p className="mt-4 text-center text-sm text-amber-700" role="status">
            {t('admin.doTasks.searchTruncated')}
          </p>
        )}

        {/* Load failure: distinguishable from a genuinely empty result */}
        {doTasksError && (
          <p className="mt-4 text-center text-sm text-brand-600" role="alert">
            {t('admin.doTasks.loadError')}
          </p>
        )}

        {!doTasksLoading && doTasksHasMore && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={doTasksLoadingMore}
            >
              {t('admin.loadMore')}
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation. The copy names the cascade explicitly: this is
          a hard delete that also removes the task's offers and its photo
          objects (§11.4), which no other admin action in this panel does. */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(false);
        }}
        ariaLabel={t('admin.doTasks.deleteTitle')}
      >
        <h3 className="mb-2 text-lg font-semibold">{t('admin.doTasks.deleteTitle')}</h3>
        <p className="mb-4 text-sm text-gray-600">
          {t('admin.doTasks.confirmDelete', { title: deleteTarget?.title ?? '' })}
        </p>
        {deleteError && (
          <p className="mb-4 text-sm text-brand-600" role="alert">
            {t('admin.doTasks.deleteError')}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDeleteTarget(null);
              setDeleteError(false);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleDelete} disabled={deleting}>
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
