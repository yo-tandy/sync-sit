import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  TASK_CATEGORIES,
  getSubCategories,
  type AdultPresence,
  type TaskCategory,
  type TaskDoc,
  type TaskTiming,
} from '@ejm/do-core';
import { Badge, Button, Card, ChevronRightIcon, EmptyState, SearchIcon, Select, Spinner } from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { formatTimingSummary, tsMillis } from '@/lib/taskDisplay';
import { useTaskPhotoUrls } from '@/lib/useTaskPhotoUrls';

/** Tasks per server page. */
export const BOARD_PAGE_SIZE = 25;

const TIMINGS: TaskTiming[] = ['fixed', 'deadline', 'recurring', 'ongoing'];
const ADULT: AdultPresence[] = ['yes', 'partly', 'no'];

/** First-photo thumbnail; signed via `doGetTaskPhotoUrl` like every task
 * photo render (§7.4). Absent or failed photos degrade to nothing. */
function CardThumb({ task }: { task: TaskDoc }) {
  const first = useMemo(() => task.photos.slice(0, 1), [task.photos]);
  const { urls } = useTaskPhotoUrls(task.taskId, first);
  if (first.length === 0) return null;
  const url = urls[first[0].photoId];
  if (!url) return <div className="h-16 w-16 shrink-0 rounded-lg bg-gray-100" aria-hidden />;
  return <img src={url} alt="" data-testid="board-photo" className="h-16 w-16 shrink-0 rounded-lg object-cover" />;
}

/**
 * The board (plan §9.2) — the app's home screen: the demand feed of open
 * tasks, newest first.
 *
 * THE QUERY SPLIT IS THE SPEC (§7.3): `status` + `category` are the ONLY
 * server-side filters — the query is always `where(status=='open')` plus
 * an optional `where(category==…)`, ordered `createdAt desc`, paged.
 * Everything else the filter row offers — sub-category, timing, area,
 * adult-present, transport — narrows CLIENT-SIDE over the fetched page.
 * Promoting any of them to the server means a composite per filter
 * combination (the power set §7.3 refuses) and a silent 400 on the missing
 * index. Expired-but-unswept tasks (`expiresAt <= now`) are filtered
 * client-side too, per §6.1 (expiry is not a status).
 *
 * Cards carry BOARD-VISIBLE fields only (§11.2): title, category/timing,
 * areaLabel + familyName — never an address or latLng, which the docs do
 * not even hold pre-assignment.
 */
export function BoardPage() {
  const { t } = useTranslation();

  // Server-side dimension: category ('' = all).
  const [category, setCategory] = useState<TaskCategory | ''>('');
  const [tasks, setTasks] = useState<TaskDoc[] | null>(null);
  // The category the rows in `tasks` were fetched for. Staleness is DERIVED
  // from it rather than blanking `tasks` synchronously inside the effect,
  // which cascades renders; the spinner shows while it lags `category`.
  const [loadedCategory, setLoadedCategory] = useState<TaskCategory | '' | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(true);
  // Expiry is judged against the clock captured at fetch time (the
  // usePublishedSearches idiom, render-purity).
  const [fetchedAt, setFetchedAt] = useState(0);
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  // Client-side narrowing dimensions (§7.3's split).
  const [subCategory, setSubCategory] = useState('');
  const [timing, setTiming] = useState<TaskTiming | ''>('');
  const [area, setArea] = useState('');
  const [adultPresent, setAdultPresent] = useState<AdultPresence | ''>('');
  const [transport, setTransport] = useState<'any' | 'yes' | 'no'>('any');

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const parts = [where('status', '==', 'open')];
      if (category) parts.push(where('category', '==', category));
      const tail = [orderBy('createdAt', 'desc'), limit(BOARD_PAGE_SIZE)];
      const cursor = !reset && cursorRef.current ? [startAfter(cursorRef.current)] : [];
      try {
        const snap = await getDocs(query(collection(db, 'doTasks'), ...parts, ...tail, ...cursor));
        const rows = snap.docs.map((d) => ({ ...(d.data() as TaskDoc), taskId: d.id }));
        cursorRef.current = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : cursorRef.current;
        setExhausted(snap.docs.length < BOARD_PAGE_SIZE);
        setFetchedAt(Date.now());
        setTasks((prev) => (reset || prev === null ? rows : [...prev, ...rows]));
        setLoadedCategory(category);
        setError(false);
      } catch {
        setError(true);
      }
    },
    [category],
  );

  useEffect(() => {
    cursorRef.current = null;
    // Deferred to a microtask so nothing this effect triggers can land a
    // setState in the same commit (react-hooks/set-state-in-effect): every
    // write inside `fetchPage` is already behind its `await getDocs`, but
    // the rule analyses the call, not the await boundary. Staleness is
    // derived from `loadedCategory`, so a superseded page is ignored on
    // arrival rather than raced.
    void Promise.resolve().then(() => fetchPage(true));
  }, [fetchPage]);

  const areas = useMemo(
    () => [...new Set((tasks ?? []).map((task) => task.areaLabel).filter(Boolean))].sort(),
    [tasks],
  );

  const visible = useMemo(
    () =>
      (tasks ?? []).filter(
        (task) =>
          tsMillis(task.expiresAt) > fetchedAt &&
          (subCategory === '' || task.subCategory === subCategory) &&
          (timing === '' || task.timing === timing) &&
          (area === '' || task.areaLabel === area) &&
          (adultPresent === '' || task.adultPresent === adultPresent) &&
          (transport === 'any' || task.transportNeeded === (transport === 'yes')),
      ),
    [tasks, fetchedAt, subCategory, timing, area, adultPresent, transport],
  );

  if (error) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t('doer.board.loadError')}</p>;
  }

  return (
    <div className="px-6 pt-4 pb-8">
      <h1 className="mb-4 text-xl font-bold text-gray-950">{t('doer.board.title')}</h1>

      <div className="mb-2 grid grid-cols-2 gap-x-2">
        <Select
          label={t('doer.board.filterCategory')}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as TaskCategory | '');
            setSubCategory('');
          }}
          options={[
            { value: '', label: t('doer.board.filterAll') },
            ...TASK_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) })),
          ]}
        />
        <Select
          label={t('doer.board.filterSubCategory')}
          value={subCategory}
          onChange={(e) => setSubCategory(e.target.value)}
          disabled={category === ''}
          options={[
            { value: '', label: t('doer.board.filterAll') },
            ...(category === '' ? [] : getSubCategories(category)).map((def) => ({
              value: def.key,
              label: t(`subcategories.${def.key}`),
            })),
          ]}
        />
        <Select
          label={t('doer.board.filterTiming')}
          value={timing}
          onChange={(e) => setTiming(e.target.value as TaskTiming | '')}
          options={[
            { value: '', label: t('doer.board.filterAny') },
            ...TIMINGS.map((tm) => ({ value: tm, label: t(`timing.${tm}`) })),
          ]}
        />
        <Select
          label={t('doer.board.filterArea')}
          value={area}
          onChange={(e) => setArea(e.target.value)}
          options={[
            { value: '', label: t('doer.board.filterAll') },
            ...areas.map((a) => ({ value: a, label: a })),
          ]}
        />
        <Select
          label={t('doer.board.filterAdultPresent')}
          value={adultPresent}
          onChange={(e) => setAdultPresent(e.target.value as AdultPresence | '')}
          options={[
            { value: '', label: t('doer.board.filterAny') },
            ...ADULT.map((a) => ({
              value: a,
              label: t(`doer.board.filter${a.charAt(0).toUpperCase()}${a.slice(1)}`),
            })),
          ]}
        />
        <Select
          label={t('doer.board.filterTransport')}
          value={transport}
          onChange={(e) => setTransport(e.target.value as 'any' | 'yes' | 'no')}
          options={[
            { value: 'any', label: t('doer.board.filterAny') },
            { value: 'yes', label: t('doer.board.filterYes') },
            { value: 'no', label: t('doer.board.filterNo') },
          ]}
        />
      </div>

      {tasks === null || loadedCategory !== category ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-6 w-6" />}
          message={t(tasks.length === 0 ? 'doer.board.empty' : 'doer.board.emptyFiltered')}
        />
      ) : (
        visible.map((task) => (
          <Link key={task.taskId} to={`/tasks/${task.taskId}`} className="block">
            <Card className="mb-3 transition-colors hover:border-brand-300">
              <div className="flex items-start gap-3">
                <CardThumb task={task} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{task.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {t(`categories.${task.category}`)} · {t(`subcategories.${task.subCategory}`)}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatTimingSummary(t, task)} · {task.areaLabel} · {task.familyName}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant={task.adultPresent === 'yes' ? 'green' : task.adultPresent === 'partly' ? 'amber' : 'gray'}>
                      {t(
                        task.adultPresent === 'yes'
                          ? 'doer.board.adultYesBadge'
                          : task.adultPresent === 'partly'
                            ? 'doer.board.adultPartlyBadge'
                            : 'doer.board.adultNoBadge',
                      )}
                    </Badge>
                    {task.transportNeeded && <Badge variant="blue">{t('doer.board.transportBadge')}</Badge>}
                    {task.suggestedBudget !== null && (
                      <span className="text-xs font-medium text-gray-600">
                        {t('doer.board.suggestedBudget', { amount: task.suggestedBudget })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 text-gray-300" />
              </div>
            </Card>
          </Link>
        ))
      )}

      {tasks !== null && !exhausted && (
        <Button
          variant="outline"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            await fetchPage(false);
            setLoadingMore(false);
          }}
        >
          {loadingMore ? t('doer.board.loading') : t('doer.board.loadMore')}
        </Button>
      )}
    </div>
  );
}
