import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getParentProfile } from '@ejm/shared-core';
import type { DoerEndorsementDoc, TaskDoc } from '@ejm/do-core';
import {
  Badge,
  Button,
  Card,
  ChevronRightIcon,
  DashboardGreeting,
  DashboardSection,
  EmptyState,
  PlusIcon,
  SkeletonCard,
  useRefetchOnFocus,
} from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary, tsMillis } from '@/lib/taskDisplay';

/** How many completions the landing page keeps — see `completedRows`. */
const RECENT_COMPLETIONS = 5;

/**
 * The family portal's landing page (plan §9.0's route table: "**Each index is
 * a DASHBOARD, not a list**"), replacing PR A's temporary `/family` →
 * `/family/tasks` redirect.
 *
 * SHAPE — sit's `FamilyDashboard` and study's family `DashboardPage`, which
 * are themselves one shape (issue #338): `DashboardGreeting` over a single
 * prominent quick action over collapsible `DashboardSection`s of live rows,
 * with skeletons while loading, one error line when nothing could be read,
 * and a centred empty state pointing at the one thing to do next. Rows
 * NAVIGATE — they never fire a callable, the rule all four sibling
 * dashboards follow — so accept/decline/mark-done/endorse all stay on
 * `/family/tasks/:taskId`, which owns them.
 *
 * SECTIONS, in sync-do's demand-first order:
 *  1. **Open tasks** (amber) — the offers awaiting review. Amber badges what
 *     the reader must ANSWER (the uniform rule of PR #345 round 2), so the
 *     count is the number of open tasks WITH offers, over a total of every
 *     live open task.
 *  2. **In progress** (green) — assigned work. Green badges the row count.
 *  3. **Recently completed** (gray) — with the §9.1 endorsement prompt on
 *     any completion this family has not endorsed yet.
 *
 * QUERIES — no callable, index or rule is added, and three of the four are
 * shapes THIS app already issues:
 *  - `doTasks` where(familyId) orderBy(createdAt desc) — MyTasksPage's.
 *  - `taskOffers` where(familyId) where(status=='pending') orderBy(createdAt)
 *    — §9.1's ONE list-wide badge query, grouped client-side by taskId.
 *    **Never `offerCount`**, which counts `pending_guardian` offers the
 *    family cannot read and would badge a number contradicting the visible
 *    list (§4.1 "BOUND-FACING ONLY").
 *  - `families/{familyId}` getDoc for the greeting's context line, exactly
 *    as both sibling family dashboards read it.
 *
 * The fourth is NEW TO do-web and its precedent is elsewhere, so it is worth
 * naming precisely rather than waving at:
 *  - `references` where(submittedByFamilyId) where(appSource=='do') — the
 *    endorsement gate. No other do-web call site issues it: the family-facing
 *    half of do's endorsements has only ever been the per-task prompt, which
 *    asks the SERVER (`doSubmitEndorsement`'s `already-exists`) rather than
 *    reading the collection. The shape is study-web's — `SessionsPage` and
 *    `SubmittedEndorsementsPage` both run
 *    `where(submittedByFamilyId) where(appSource=='study')` for exactly this
 *    gate — with do's `appSource`, and it is the same field pair the do
 *    server already dedups on (`apps/functions/src/do/submitEndorsement.ts`).
 *    Provable under the `references` read rule's submitting-family disjunct
 *    (`firestore.rules:488-489`), and equality-only, so it needs no composite.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const [familyName, setFamilyName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskDoc[] | null>(null);
  const [tasksError, setTasksError] = useState(false);
  const [pendingByTask, setPendingByTask] = useState<Record<string, number>>({});
  /** doerUserIds this family has already endorsed — gates the §9.1 prompt. */
  const [endorsedDoers, setEndorsedDoers] = useState<Set<string>>(new Set());
  // Expiry is judged against the clock captured AT snapshot time (MyTasksPage's
  // idiom, and render purity): fresh enough — every task change re-delivers
  // the snapshot.
  const [snapshotNow, setSnapshotNow] = useState(0);

  // Shared by the one-shot reads and every focus refetch, so a late resolve
  // never writes state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        setTasksError(false);
      },
      () => setTasksError(true),
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
      // Badge failure is cosmetic: the sections still render (MyTasksPage's
      // rule). It cannot strand the page, because the tasks read is what
      // gates loading.
      () => setPendingByTask({}),
    );
    return unsub;
  }, [familyId]);

  const loadFamilyName = useCallback(() => {
    if (!familyId) return;
    getDoc(doc(db, 'families', familyId))
      .then((snap) => {
        if (!mountedRef.current) return;
        setFamilyName(snap.exists() ? ((snap.data()?.familyName as string | undefined) ?? null) : null);
      })
      .catch(() => {
        // The context line is decoration: a failed read leaves the greeting
        // name-only rather than blocking anything.
      });
  }, [familyId]);

  const loadEndorsed = useCallback(() => {
    if (!familyId) return;
    getDocs(
      query(
        collection(db, 'references'),
        where('submittedByFamilyId', '==', familyId),
        where('appSource', '==', 'do'),
      ),
    )
      .then((snap) => {
        if (!mountedRef.current) return;
        const rows = snap.docs.map((d) => d.data() as DoerEndorsementDoc);
        setEndorsedDoers(new Set(rows.map((r) => r.doerUserId)));
      })
      .catch(() => {
        // A denied/failed endorsements read must not block the completions
        // section (study's SessionsPage rule): fall back to "none endorsed".
        // Worst case is a prompt the callable then refuses `already-exists`,
        // which EndorseDoerDialog already handles gracefully.
        if (mountedRef.current) setEndorsedDoers(new Set());
      });
  }, [familyId]);

  useEffect(() => {
    loadFamilyName();
  }, [loadFamilyName]);

  useEffect(() => {
    loadEndorsed();
  }, [loadEndorsed]);

  // Issue #117 tier (a): the two list queries are live already, so only the
  // one-shot reads re-run when the reader comes back to the tab.
  useRefetchOnFocus(() => {
    loadFamilyName();
    loadEndorsed();
  });

  const { openRows, assignedRows, completedRows } = useMemo(() => {
    const all = tasks ?? [];
    return {
      // Live open tasks only. An EXPIRED open task can no longer be acted on
      // (`doAcceptOffer` refuses `task_expired`), so it is not "what needs me
      // right now" — the same reason the sibling dashboards floor their
      // pending rows on today's date. It keeps its Expired badge on
      // /family/tasks. Soonest-to-expire first: `expiresAt` is the clock that
      // is actually running, and it is the one ordering key every task
      // carries whichever of §4.1's four timing models it uses.
      openRows: all
        .filter((task) => task.status === 'open' && tsMillis(task.expiresAt) > snapshotNow)
        .slice()
        .sort((a, b) => tsMillis(a.expiresAt) - tsMillis(b.expiresAt)),
      // Newest-first, inherited from the query's createdAt DESC: a task has
      // no single date across the four timing models to sort these by.
      assignedRows: all.filter((task) => task.status === 'assigned'),
      // Most recently completed first, capped: decision 19 keeps completed
      // tasks for six months, so an unbounded list would push the live
      // sections off a long-standing family's screen. The full history stays
      // on /family/tasks.
      completedRows: all
        .filter((task) => task.status === 'completed')
        .slice()
        .sort((a, b) => tsMillis(b.completedAt) - tsMillis(a.completedAt))
        .slice(0, RECENT_COMPLETIONS),
    };
  }, [tasks, snapshotNow]);

  /** Completions this family could still endorse — the §9.1 prompt's gate. */
  const endorsable = (task: TaskDoc): boolean =>
    !!task.assignedUserId && !endorsedDoers.has(task.assignedUserId);

  // With no familyId nothing can load at all, so fall through to the empty
  // state rather than spinning forever (study's family-dashboard rule).
  const loading = familyId !== null && tasks === null && !tasksError;
  const hasAny = openRows.length > 0 || assignedRows.length > 0 || completedRows.length > 0;
  // The amber badge is a TO-DO count: open tasks with offers to review.
  const openTodo = openRows.filter((task) => (pendingByTask[task.taskId] ?? 0) > 0).length;

  const metaLine = (task: TaskDoc) =>
    `${t(`categories.${task.category}`)} · ${formatTimingSummary(t, task)}`;

  const row = (task: TaskDoc, badges: React.ReactNode) => (
    <Link key={task.taskId} to={`/family/tasks/${task.taskId}`} className="block">
      <Card interactive>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{task.title}</p>
            <p className="mt-0.5 text-xs text-gray-500">{metaLine(task)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badges}</div>
          </div>
          <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
        </div>
      </Card>
    </Link>
  );

  return (
    // Wide desktop tier (issue #119), like study's family dashboard: the
    // sections want the 5xl cap.
    <div className="px-5 pt-4 pb-8" data-page-width="wide">
      {/* The shared header idiom (parity D1, issue #239). */}
      <DashboardGreeting
        firstName={userDoc?.firstName}
        contextLine={
          familyName ? `${familyName.toUpperCase()} ${t('family.dashboard.family')}` : undefined
        }
      />

      {/* The page's one prominent action, in both siblings' slot (sit's "Find
          a babysitter", study's "Find a tutor"). Unconditional, unlike
          theirs: sync-do reads no verification flag anywhere in this app —
          `doPostTask` is the gate and the wizard's review step already maps
          its verification refusal to its own copy, so putting a second,
          client-side guess in front of it would only be able to be wrong. */}
      <Button className="mb-6 h-14 text-lg" onClick={() => navigate('/family/post')}>
        <PlusIcon className="h-5 w-5" />
        {t('family.dashboard.postCta')}
      </Button>

      {tasksError && !hasAny ? (
        <p className="py-10 text-center text-sm text-gray-500">{t('family.dashboard.loadError')}</p>
      ) : loading ? (
        // Skeletons, not a spinner: this is a list surface, so it keeps its
        // footprint while loading (UX F12, issue #126).
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : hasAny ? (
        <>
          <DashboardSection
            title={t('family.dashboard.openTitle')}
            count={openTodo}
            total={openRows.length}
            variant="pending"
          >
            {openRows.map((task) => {
              const pending = pendingByTask[task.taskId] ?? 0;
              return row(
                task,
                pending > 0 ? (
                  <Badge variant="green">{t('family.myTasks.offerCount', { count: pending })}</Badge>
                ) : (
                  <Badge variant="gray">{t('family.myTasks.noOffersYet')}</Badge>
                ),
              );
            })}
          </DashboardSection>

          <DashboardSection
            title={t('family.dashboard.assignedTitle')}
            count={assignedRows.length}
            variant="confirmed"
          >
            {assignedRows.map((task) =>
              row(
                task,
                task.doerMarkedDoneAt !== null ? (
                  <Badge variant="amber">{t('family.myTasks.doerMarkedDone')}</Badge>
                ) : (
                  <Badge variant="blue">{t('family.dashboard.inProgressBadge')}</Badge>
                ),
              ),
            )}
          </DashboardSection>

          <DashboardSection
            title={t('family.dashboard.completedTitle')}
            // No section badge: the to-do here is per-row (an endorsement is
            // owed for SOME completions), and a gray "past" badge carrying a
            // to-do count would wear the wrong colour for its meaning.
            count={0}
            total={completedRows.length}
            variant="past"
          >
            {completedRows.map((task) =>
              row(
                task,
                endorsable(task) ? (
                  <Badge variant="amber">{t('family.dashboard.endorsePrompt')}</Badge>
                ) : (
                  <Badge variant="gray">{t('family.dashboard.completedBadge')}</Badge>
                ),
              ),
            )}
          </DashboardSection>
        </>
      ) : (
        <EmptyState
          icon={<PlusIcon className="h-6 w-6" />}
          message={t('family.dashboard.emptyDesc')}
          actionLabel={t('family.dashboard.postCta')}
          actionTo="/family/post"
        />
      )}
    </div>
  );
}
