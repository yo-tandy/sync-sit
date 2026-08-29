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
  Spinner,
  useRefetchOnFocus,
} from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { SeeAllLink } from '@/components/ui/SeeAllLink';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary } from '@/lib/taskDisplay';

/**
 * How many rows a section shows before it defers to its list page — the same
 * number the family dashboard uses, for the same reason (see its
 * `SECTION_ROWS`). /doer/board is deliberately NOT one of those list pages
 * and is untouched by this: it is discovery across every family's open tasks,
 * not a longer copy of anything on here.
 */
const SECTION_ROWS = 5;

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
 * A SUMMARY, NOT A SECOND LIST (the owner's redundancy report against the
 * family portal, applied to both): each section shows at most `SECTION_ROWS`
 * and then names the total on a link into the page that owns the rest.
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
 *     they are the page's one real to-do count. Their read is one-shot, and
 *     it is part of the settled check AND has its own error + retry: it is
 *     the sole source of a whole section, so a read that was still in flight
 *     (or had failed) used to let the empty state say "Nothing on the go"
 *     over an endorsement genuinely waiting — MyEndorsementsPage's rule, and
 *     the same shape as the defect PR #331 round 2 fixed. That error state is
 *     scoped three ways (PR #362 round 2): it renders only when the read has
 *     nothing to show, its retry spins inside this section instead of
 *     reopening the page-level gate, and the page-level failure line waits
 *     for every read to settle before calling the whole page failed.
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
  // Null while in flight, NEVER `[]` on failure. A failed read is UNKNOWN,
  // not zero: degrading it to an empty array let "Nothing on the go" render
  // over an endorsement genuinely waiting for this student — an affirmative
  // false statement, the exact defect PR #331 round 2 fixed on the family
  // offer list and MyEndorsementsPage codifies (its comment: "A failed read
  // must never render as the reassuring empty state"). Its own error + retry
  // instead, and it counts toward `loading` so the empty state cannot paint
  // before it settles.
  const [endorsements, setEndorsements] = useState<DoerEndorsementDoc[] | null>(null);
  const [endorsementsError, setEndorsementsError] = useState(false);
  /**
   * Has the FIRST attempt completed — resolved or failed? This, not
   * `endorsements !== null`, is what the page-level loading gate reads, and a
   * retry deliberately does NOT reopen it: the page has already painted, and
   * pulling the offers and assigned-work sections back to skeletons because a
   * third read is being retried is the opposite of scoping (PR #362 round 2).
   */
  const [endorsementsSettled, setEndorsementsSettled] = useState(false);
  /** A retry is in flight. Scoped to this section — never the page. */
  const [endorsementsRetrying, setEndorsementsRetrying] = useState(false);
  /** Bumped by the retry button; re-runs the read through the effect below. */
  const [endorsementsTick, setEndorsementsTick] = useState(0);

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
        setEndorsementsError(false);
        setEndorsementsSettled(true);
        setEndorsementsRetrying(false);
      })
      .catch(() => {
        // Error, never an empty list — see the state declaration. Rows this
        // read has ALREADY delivered are kept: `endorsementsBlank` below is
        // what gates the error block, so a focus-refetch blip over a rendered
        // section stays invisible (study's dashboards' rule) instead of
        // replacing a real to-do with an error.
        if (!mountedRef.current) return;
        setEndorsementsError(true);
        setEndorsementsSettled(true);
        setEndorsementsRetrying(false);
      });
  }, [uid]);

  useEffect(() => {
    loadEndorsements();
    // `endorsementsTick` is the retry trigger; loadEndorsements itself only
    // depends on uid.
  }, [loadEndorsements, endorsementsTick]);

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
      (endorsements ?? []).filter(
        (e) => e.appSource === 'do' && e.type === 'family_submitted' && e.status === 'private',
      ),
    [endorsements],
  );

  // Settled = rows arrived OR the read failed; an errored read is no longer
  // in flight, so one failure never strands the page on skeletons (study's
  // family-dashboard rule). ALL THREE reads count: the endorsements read is
  // the only source of one of the three sections, so leaving it out let the
  // empty state paint over a to-do that had not arrived yet. With no uid
  // nothing can load at all.
  const loading =
    uid !== null &&
    !((offers !== null || offersError) && (tasks !== null || tasksError) && endorsementsSettled);
  const loadError = offersError || tasksError;
  const hasRows =
    liveOffers.length > 0 || assignedRows.length > 0 || pendingEndorsements.length > 0;
  // A failed endorsements read takes the section over ONLY when it has
  // nothing to show. With last-known-good rows in hand the failure is a
  // refetch blip and stays invisible; with none, "no endorsements" would be
  // an affirmative statement we cannot make, so the error block renders.
  const endorsementsBlank = endorsementsError && endorsements === null;
  // Both of those are CONTENT: without them in this gate, a denied (or
  // retrying) endorsements read on an otherwise-quiet account collapses
  // straight into "Nothing on the go" — the false statement this whole
  // branch exists to prevent.
  const hasAny = hasRows || endorsementsBlank || endorsementsRetrying;

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

      {/* `!hasRows`, not `!hasAny`: when all three reads fail there is nothing
          to show but this line, and it says more than the endorsement block
          alone would. `!loading` too: this is a verdict on the whole page, so
          it must not be delivered while a read is still out (PR #362 round
          2). In the all-failed case every read has settled, so `loading` is
          false by construction and the line still renders. */}
      {loadError && !hasRows && !loading ? (
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
            {liveOffers.slice(0, SECTION_ROWS).map((offer) => (
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
            {/* No tab is expressible here: a live offer is `pending` OR
                `pending_guardian`, which /doer/offers splits across its
                first two tabs, so the link lands on the page's own default
                (Pending) rather than asserting a tab that would be wrong for
                half the rows. */}
            {liveOffers.length > SECTION_ROWS && (
              <SeeAllLink
                to="/doer/offers"
                label={t('doer.dashboard.seeAllOffers', { total: liveOffers.length })}
              />
            )}
          </DashboardSection>

          <DashboardSection
            title={t('doer.dashboard.assignedTitle')}
            count={assignedRows.length}
            variant="confirmed"
          >
            {assignedRows.slice(0, SECTION_ROWS).map((task) => (
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
            {/* /doer/work opens on its own Assigned tab, which is exactly this
                section's set. */}
            {assignedRows.length > SECTION_ROWS && (
              <SeeAllLink
                to="/doer/work"
                label={t('doer.dashboard.seeAllAssigned', { total: assignedRows.length })}
              />
            )}
          </DashboardSection>

          {/* A failed endorsements read with NOTHING to show renders as an
              error with a retry — never as this section quietly not being
              there, which reads as "nothing to answer" (MyEndorsementsPage's
              rule, PR #331 round 2). Scoped here, so the two sections above
              still render — through the retry as well as the error. A failure
              that still has last-known-good rows renders those rows instead:
              hiding a live to-do behind an error is the same defect wearing a
              different colour. */}
          {endorsementsRetrying ? (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {t('doer.dashboard.endorsementsTitle')}
              </h3>
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            </div>
          ) : endorsementsBlank ? (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {t('doer.dashboard.endorsementsTitle')}
              </h3>
              <p className="mb-3 text-sm text-error-600">
                {t('doer.dashboard.endorsementsLoadError')}
              </p>
              <Button
                size="sm"
                variant="outline"
                fullWidth={false}
                onClick={() => {
                  // Clear the error so the retry FALLS THROUGH to a loading
                  // state — otherwise a re-failed read changes nothing on
                  // screen and the button reads as dead (the AssignedTaskView
                  // / MyEndorsementsPage retry idiom). That loading state is
                  // the spinner ABOVE, in this section's own slot: the
                  // page-level gate reads `endorsementsSettled`, which a
                  // retry never reopens, so the sections that already loaded
                  // stay on screen throughout.
                  setEndorsementsError(false);
                  setEndorsementsRetrying(true);
                  setEndorsementsTick((n) => n + 1);
                }}
              >
                {t('doer.endorsements.retry')}
              </Button>
            </div>
          ) : (
          <DashboardSection
            title={t('doer.dashboard.endorsementsTitle')}
            count={pendingEndorsements.length}
            variant="pending"
          >
            {pendingEndorsements.slice(0, SECTION_ROWS).map((e) => (
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
            {/* Capped like the other two — a doer coming back to six waiting
                endorsements should see the page say six and hand them the
                surface that answers them, not scroll a to-do list on a
                summary. /doer/endorsements has no tabs: its pending set is
                the top of the page. */}
            {pendingEndorsements.length > SECTION_ROWS && (
              <SeeAllLink
                to="/doer/endorsements"
                label={t('doer.dashboard.seeAllEndorsements', {
                  total: pendingEndorsements.length,
                })}
              />
            )}
          </DashboardSection>
          )}
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
