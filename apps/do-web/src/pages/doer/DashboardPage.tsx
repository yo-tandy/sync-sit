import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { DoerEndorsementDoc, OfferDoc, TaskDoc } from '@ejm/do-core';
import {
  Badge,
  Button,
  Card,
  ChevronRightIcon,
  DashboardGreeting,
  DashboardSection,
  EmptyState,
  SearchIcon,
  SkeletonCard,
  useRefetchOnFocus,
} from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary } from '@/lib/taskDisplay';

/**
 * The doer portal's landing page (plan §9.0's route table: "**Each index is a
 * DASHBOARD, not a list**"), replacing PR A's temporary `/doer` →
 * `/doer/board` redirect.
 *
 * SHAPE — sit's `BabysitterDashboard` and study's tutor `DashboardPage`:
 * `DashboardGreeting` over one prominent quick action over collapsible
 * `DashboardSection`s, skeletons while loading, one error line when nothing
 * could be read, a centred empty state pointing at the next thing to do.
 * Rows navigate; no callable is fired from a landing page — withdraw lives on
 * /doer/offers, mark-done on the task detail, accept/decline on
 * /doer/endorsements.
 *
 * SECTIONS:
 *  1. **Your offers** (amber) — `pending` (with the family) and
 *     `pending_guardian` (§6.2, with the student's own parent). Every row
 *     here awaits someone ELSE, so the amber badge — a TO-DO count, the
 *     uniform rule of PR #345 round 2 — stays at zero and each row says who
 *     it is waiting on. `total` is what makes the section render anyway.
 *  2. **Assigned work** (green) — status `assigned`, badging the row count,
 *     each row carrying what is next: mark it done, or (once marked) that
 *     the family still has to confirm.
 *  3. **Endorsements to answer** (amber) — these DO await this reader, so
 *     they are the page's one real to-do count.
 *
 * QUERIES — all three are shapes this app already issues; nothing new reaches
 * the server:
 *  - `taskOffers` where(doerUserId) orderBy(createdAt desc) — MyOffersPage's
 *    single query, statuses narrowed client-side (§7.3's index note).
 *  - `doTasks` where(assignedUserId) where(status in [...]) orderBy(updatedAt
 *    desc) — MyWorkPage's; the status constraint is what routes it onto the
 *    (assignedUserId, status, updatedAt) composite.
 *  - `references` where(doerUserId) orderBy(createdAt desc) —
 *    MyEndorsementsPage's, with the same defence-in-depth shape filter.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userDoc, firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [offers, setOffers] = useState<OfferDoc[] | null>(null);
  const [offersError, setOffersError] = useState(false);
  const [tasks, setTasks] = useState<TaskDoc[] | null>(null);
  const [tasksError, setTasksError] = useState(false);
  const [endorsements, setEndorsements] = useState<DoerEndorsementDoc[]>([]);

  // Shared by the one-shot read and every focus refetch, so a late resolve
  // never writes state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'taskOffers'), where('doerUserId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => {
        setOffers(snap.docs.map((d) => ({ ...(d.data() as OfferDoc), offerId: d.id })));
        setOffersError(false);
      },
      () => setOffersError(true),
    );
    return unsub;
  }, [uid]);

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
        setTasksError(false);
      },
      () => setTasksError(true),
    );
    return unsub;
  }, [uid]);

  const loadEndorsements = useCallback(() => {
    if (!uid) return;
    getDocs(
      query(collection(db, 'references'), where('doerUserId', '==', uid), orderBy('createdAt', 'desc')),
    )
      .then((snap) => {
        if (!mountedRef.current) return;
        setEndorsements(snap.docs.map((d) => d.data() as DoerEndorsementDoc));
      })
      .catch(() => {
        // A failed endorsements read must not block the two sections that
        // carry the daily loop. It degrades to "none to answer"; the surface
        // that OWNS them (/doer/endorsements) has the error + retry.
        if (mountedRef.current) setEndorsements([]);
      });
  }, [uid]);

  useEffect(() => {
    loadEndorsements();
  }, [loadEndorsements]);

  // Issue #117 tier (a): the two list queries are live already, so only the
  // one-shot read re-runs when the reader comes back to the tab.
  useRefetchOnFocus(loadEndorsements);

  // Live offers, in the query's newest-first order. `pending` first, then
  // `pending_guardian`: the same within-section ordering the tutor dashboard
  // uses (the rows the other side is actually looking at, then the ones still
  // upstream of them).
  const liveOffers = useMemo(() => {
    const all = offers ?? [];
    return [
      ...all.filter((o) => o.status === 'pending'),
      ...all.filter((o) => o.status === 'pending_guardian'),
    ];
  }, [offers]);

  const assignedRows = useMemo(
    () => (tasks ?? []).filter((task) => task.status === 'assigned'),
    [tasks],
  );

  // Exactly the rows /doer/endorsements would let this doer act on — the
  // same defence-in-depth shape filter, for the same reason: a doc forged
  // before PR #352 tightened the create rule could otherwise render here
  // with attacker-controlled attribution.
  const pendingEndorsements = useMemo(
    () =>
      endorsements.filter(
        (e) => e.appSource === 'do' && e.type === 'family_submitted' && e.status === 'private',
      ),
    [endorsements],
  );

  // Settled = rows arrived OR the read failed; an errored read is no longer
  // in flight, so one failure never strands the page on skeletons (study's
  // family-dashboard rule). With no uid nothing can load at all.
  const loading =
    uid !== null && !((offers !== null || offersError) && (tasks !== null || tasksError));
  const loadError = offersError || tasksError;
  const hasAny =
    liveOffers.length > 0 || assignedRows.length > 0 || pendingEndorsements.length > 0;

  return (
    <div className="px-5 pt-4 pb-8" data-page-width="wide">
      {/* The shared header idiom (parity D1, issue #239). No search-visibility
          pill in the `action` slot: sync-do's provider has no searchable flag
          — decision 1 inverts the marketplace, so a doer is not searched for,
          they browse and offer. */}
      <DashboardGreeting
        firstName={userDoc?.firstName}
        contextLine={t('doer.dashboard.greeting')}
      />

      {/* The page's one prominent action, in both providers' slot. */}
      <Button className="mb-6 h-14 text-lg" onClick={() => navigate('/doer/board')}>
        <SearchIcon className="h-5 w-5" />
        {t('doer.dashboard.boardCta')}
      </Button>

      {loadError && !hasAny ? (
        <p className="py-10 text-center text-sm text-gray-500">{t('doer.dashboard.loadError')}</p>
      ) : loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : hasAny ? (
        <>
          <DashboardSection
            title={t('doer.dashboard.offersTitle')}
            // Zero deliberately: every live offer awaits the family or the
            // student's own parent, so none of them is this reader's to-do.
            count={0}
            total={liveOffers.length}
            variant="pending"
          >
            {liveOffers.map((offer) => (
              <Link key={offer.offerId} to="/doer/offers" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {offer.taskTitle}
                        </p>
                        <p className="shrink-0 text-sm font-bold text-brand-800">
                          {offer.price} €{' '}
                          <span className="text-xs font-medium text-gray-500">
                            {t(
                              offer.priceBasis === 'hourly'
                                ? 'doer.myOffers.basisHourly'
                                : 'doer.myOffers.basisFlat',
                            )}
                          </span>
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t(`categories.${offer.taskCategory}`)} · {t(`timing.${offer.taskTiming}`)}
                      </p>
                      <p className="mt-1 text-xs text-amber-700">
                        {offer.status === 'pending_guardian'
                          ? t('doer.dashboard.awaitingParent')
                          : t('doer.dashboard.awaitingFamily')}
                      </p>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
                  </div>
                </Card>
              </Link>
            ))}
          </DashboardSection>

          <DashboardSection
            title={t('doer.dashboard.assignedTitle')}
            count={assignedRows.length}
            variant="confirmed"
          >
            {assignedRows.map((task) => (
              <Link key={task.taskId} to={`/doer/tasks/${task.taskId}`} className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{task.title}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t(`categories.${task.category}`)} · {formatTimingSummary(t, task)} ·{' '}
                        {task.areaLabel}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {task.agreedPrice !== null && (
                          <span className="text-xs font-medium text-gray-600">
                            {t('doer.myWork.agreedPrice', { amount: task.agreedPrice })}
                          </span>
                        )}
                        {task.doerMarkedDoneAt !== null ? (
                          <Badge variant="amber">{t('doer.myWork.awaitingFamilyBadge')}</Badge>
                        ) : (
                          <Badge variant="blue">{t('doer.dashboard.nextMarkDone')}</Badge>
                        )}
                      </div>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
                  </div>
                </Card>
              </Link>
            ))}
          </DashboardSection>

          <DashboardSection
            title={t('doer.dashboard.endorsementsTitle')}
            count={pendingEndorsements.length}
            variant="pending"
          >
            {pendingEndorsements.map((e) => (
              <Link key={e.referenceId} to="/doer/endorsements" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {e.submittedByName || e.refName || t('doer.endorsements.anonymous')}
                      </p>
                      <p className="mt-1 text-xs text-amber-700">
                        {t('doer.dashboard.endorsementPrompt')}
                      </p>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" />
                  </div>
                </Card>
              </Link>
            ))}
          </DashboardSection>
        </>
      ) : (
        <EmptyState
          icon={<SearchIcon className="h-6 w-6" />}
          message={t('doer.dashboard.emptyDesc')}
          actionLabel={t('doer.dashboard.boardCta')}
          actionTo="/doer/board"
        />
      )}
    </div>
  );
}
