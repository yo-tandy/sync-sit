import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { TaskDoc } from '@ejm/do-core';
import { Badge, Card, ChevronRightIcon, ClipboardListIcon, EmptyState, Spinner } from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary } from '@/lib/taskDisplay';

type Tab = 'assigned' | 'completed' | 'cancelled';
const TABS: Tab[] = ['assigned', 'completed', 'cancelled'];

/**
 * The student's assigned work (plan §9.2 "My tasks"): one live query over
 * `where('assignedUserId','==',uid)` — provable under §7.2's
 * own-assignment disjunct — constrained to the three post-assignment
 * statuses and ordered `updatedAt desc` so it is served by §7.3's
 * `(assignedUserId, status, updatedAt)` composite (the status constraint
 * is what routes the query onto that index; a bare
 * assignedUserId+orderBy(updatedAt) has no composite). Tabs narrow
 * client-side over the one list, per the same §7.3 split as everywhere
 * else.
 *
 * `cancelled` gets a tab even though §9.2's bullet names assigned work:
 * §6.4's aftermath grace serves contact for days after a cancellation,
 * and a cancelled assignment the student can never navigate back to would
 * make that grace unreachable from this side.
 *
 * Cards link to /doer/tasks/:taskId — readable by the caller precisely because
 * assignedUserId is theirs (§7.2) — where AssignedWorkView carries
 * contact, checklist, mark-done and cancel.
 */
export function MyWorkPage() {
  const { t } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [tab, setTab] = useState<Tab>('assigned');
  const [tasks, setTasks] = useState<TaskDoc[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(
        collection(db, 'doTasks'),
        where('assignedUserId', '==', uid),
        where('status', 'in', ['assigned', 'completed', 'cancelled']),
        orderBy('updatedAt', 'desc'),
      ),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ ...(d.data() as TaskDoc), taskId: d.id })));
        setError(false);
      },
      () => setError(true),
    );
    return unsub;
  }, [uid]);

  const byTab = useMemo(() => {
    const groups: Record<Tab, TaskDoc[]> = { assigned: [], completed: [], cancelled: [] };
    for (const task of tasks ?? []) {
      if (TABS.includes(task.status as Tab)) groups[task.status as Tab].push(task);
    }
    return groups;
  }, [tasks]);

  if (error) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t('doer.myWork.loadError')}</p>;
  }
  if (tasks === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const emptyKey = {
    assigned: 'doer.myWork.emptyAssigned',
    completed: 'doer.myWork.emptyCompleted',
    cancelled: 'doer.myWork.emptyCancelled',
  }[tab];

  return (
    <div className="px-6 pt-4 pb-8">
      <h1 className="mb-4 text-xl font-bold text-gray-950">{t('doer.myWork.title')}</h1>

      <div role="tablist" aria-label={t('doer.myWork.title')} className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
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
            {t(`doer.myWork.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {byTab[tab].length === 0 ? (
        <EmptyState icon={<ClipboardListIcon className="h-6 w-6" />} message={t(emptyKey)} />
      ) : (
        byTab[tab].map((task) => (
          <Link key={task.taskId} to={`/doer/tasks/${task.taskId}`} className="block">
            <Card className="mb-3 transition-colors hover:border-brand-300">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{task.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {t(`categories.${task.category}`)} · {formatTimingSummary(t, task)} · {task.areaLabel}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {task.agreedPrice !== null && (
                      <span className="text-xs font-medium text-gray-600">
                        {t('doer.myWork.agreedPrice', { amount: task.agreedPrice })}
                      </span>
                    )}
                    {task.status === 'assigned' && task.doerMarkedDoneAt !== null && (
                      <Badge variant="amber">{t('doer.myWork.awaitingFamilyBadge')}</Badge>
                    )}
                  </div>
                </div>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
              </div>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
