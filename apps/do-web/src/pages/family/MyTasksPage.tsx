import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getParentProfile } from '@ejm/shared-core';
import type { TaskDoc } from '@ejm/do-core';
import { Badge, Card, ChevronRightIcon, EmptyState, PlusIcon, Spinner } from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary, tsMillis } from '@/lib/taskDisplay';

type Tab = 'open' | 'assigned' | 'completed' | 'cancelled';
const TABS: Tab[] = ['open', 'assigned', 'completed', 'cancelled'];

/**
 * The family's task list (plan §9.1 "My tasks"): one live query over the
 * family's own tasks, four status tabs filtered client-side.
 *
 * The open tab's offer-count badge comes from ONE list-wide query over
 * `taskOffers` — `where(familyId==f).where(status=='pending')
 * .orderBy(createdAt)` — grouped client-side by taskId (§9.1's stated
 * shape: provable under §7.2's family disjunct and served by the
 * (familyId, status, createdAt) composite). Deliberately NOT one query per
 * task, and NEVER the task's `offerCount` field: that counts
 * pending_guardian offers the family cannot see, so a task with hidden
 * gated offers would badge a number contradicting its own visible list
 * (§4.1 "BOUND-FACING ONLY").
 *
 * `?tab=` picks the OPENING tab. The family dashboard's capped sections hand
 * their overflow here, and its In-progress and Recently-completed sections
 * would otherwise land the reader on Open — a see-all that shows something
 * else is worse than no see-all. Nothing about the page's own tabs changes:
 * the param seeds the initial state only, so a click still wins and the URL
 * is never rewritten behind the reader.
 */
export function MyTasksPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const [searchParams] = useSearchParams();
  // Lazy initialiser: read once, at mount. An unknown or absent value falls
  // back to Open, the page's long-standing default — a hand-typed
  // `?tab=nonsense` must not be able to produce a tabless page.
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return TABS.includes(requested as Tab) ? (requested as Tab) : 'open';
  });
  const [tasks, setTasks] = useState<TaskDoc[] | null>(null);
  const [pendingByTask, setPendingByTask] = useState<Record<string, number>>({});
  const [error, setError] = useState(false);
  // Expiry is judged against the clock captured AT snapshot time (the
  // usePublishedSearches idiom, and render-purity): fresh enough — every
  // task change re-delivers the snapshot.
  const [snapshotNow, setSnapshotNow] = useState(0);

  useEffect(() => {
    if (!familyId) return;
    const unsub = onSnapshot(
      query(
        collection(db, 'doTasks'),
        where('familyId', '==', familyId),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ ...(d.data() as TaskDoc), taskId: d.id })));
        setSnapshotNow(Date.now());
        setError(false);
      },
      () => setError(true),
    );
    return unsub;
  }, [familyId]);

  useEffect(() => {
    if (!familyId) return;
    const unsub = onSnapshot(
      query(
        collection(db, 'taskOffers'),
        where('familyId', '==', familyId),
        where('status', '==', 'pending'),
        orderBy('createdAt'),
      ),
      (snap) => {
        const counts: Record<string, number> = {};
        for (const d of snap.docs) {
          const taskId = (d.data() as { taskId?: string }).taskId;
          if (taskId) counts[taskId] = (counts[taskId] ?? 0) + 1;
        }
        setPendingByTask(counts);
      },
      // Badge failure is cosmetic: the list itself still renders.
      () => setPendingByTask({}),
    );
    return unsub;
  }, [familyId]);

  const byTab = useMemo(() => {
    const groups: Record<Tab, TaskDoc[]> = { open: [], assigned: [], completed: [], cancelled: [] };
    for (const task of tasks ?? []) {
      if (TABS.includes(task.status as Tab)) groups[task.status as Tab].push(task);
    }
    return groups;
  }, [tasks]);

  if (error) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t('family.myTasks.loadError')}</p>;
  }
  if (tasks === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const emptyKey = {
    open: 'family.myTasks.emptyOpen',
    assigned: 'family.myTasks.emptyAssigned',
    completed: 'family.myTasks.emptyCompleted',
    cancelled: 'family.myTasks.emptyCancelled',
  }[tab];

  return (
    <div className="px-6 pt-4 pb-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-950">{t('family.myTasks.title')}</h1>
        <Link
          to="/family/post"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-all hover:bg-brand-600/90"
        >
          <PlusIcon className="h-4 w-4" />
          {t('family.myTasks.postCta')}
        </Link>
      </div>

      <div role="tablist" aria-label={t('family.myTasks.title')} className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`family.myTasks.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {byTab[tab].length === 0 ? (
        tab === 'open' ? (
          <EmptyState
            icon={<PlusIcon className="h-6 w-6" />}
            message={t(emptyKey)}
            actionLabel={t('family.myTasks.postCta')}
            actionTo="/family/post"
          />
        ) : (
          <EmptyState icon={<ChevronRightIcon className="h-6 w-6" />} message={t(emptyKey)} />
        )
      ) : (
        byTab[tab].map((task) => {
          const pending = pendingByTask[task.taskId] ?? 0;
          const expired = task.status === 'open' && tsMillis(task.expiresAt) <= snapshotNow;
          return (
            <Link key={task.taskId} to={`/family/tasks/${task.taskId}`} className="block">
              <Card className="mb-3 transition-colors hover:border-brand-300">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{task.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t(`categories.${task.category}`)} · {formatTimingSummary(t, task)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {task.status === 'open' &&
                        (expired ? (
                          <Badge variant="gray">{t('family.myTasks.expiredBadge')}</Badge>
                        ) : pending > 0 ? (
                          <Badge variant="green">{t('family.myTasks.offerCount', { count: pending })}</Badge>
                        ) : (
                          <Badge variant="gray">{t('family.myTasks.noOffersYet')}</Badge>
                        ))}
                      {task.status === 'assigned' && task.doerMarkedDoneAt !== null && (
                        <Badge variant="amber">{t('family.myTasks.doerMarkedDone')}</Badge>
                      )}
                    </div>
                  </div>
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
                </div>
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}
