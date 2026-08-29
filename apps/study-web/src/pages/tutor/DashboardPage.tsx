import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import type { StudyContactRequestDoc } from '@ejm/study-core';
import type { RecurringSlot } from '@ejm/shared-core';
import { DAYS_OF_WEEK } from '@ejm/shared-core';
import { PublishedSearchesPreview } from '@/components/published/PublishedSearchesPreview';
import { SupervisionRequestCard } from '@/components/tutor/SupervisionRequestCard';
import { InstallAppBanner } from '@/components/ui/InstallAppBanner';
import type { StudySessionDoc } from '@/types/studySession';
import {
  Card,
  Button,
  Dialog,
  Spinner,
  CalendarIcon,
  ChevronRightIcon,
  UsersIcon,
  useRefetchOnFocus,
  DashboardGreeting,
  DashboardSection,
} from '@ejm/shared-ui';

/** Paris "YYYY-MM-DD" today (en-CA renders ISO order; tz-correct via runtime). */
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Format a "YYYY-MM-DD" date field-by-field (never `new Date(str)`, which
 * reads as UTC midnight and can slip a day in negative offsets). */
function formatDateStr(s: string | undefined, lang: string): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** 3-letter weekday code → the full-name i18n key under `days.*`. */
const DAY_FULL: Record<RecurringSlot['day'], string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/**
 * Tutor dashboard, structured to match sync-sit's babysitter dashboard (issue
 * #165): install-app suggestion, an availability box linking the schedule, a
 * New Requests section, and a Confirmed sessions section. Endorsements,
 * subjects & rates and account moved to the hamburger menu (see AppBar).
 *
 * PR #77's verification state contract is SUPERSEDED (owner decision
 * 2026-08-17): tutor identity verification was dropped, so there is no
 * verification banner and no /tutor/verification page. `enrollmentComplete`
 * is written true at creation for every current tutor; it is still read here
 * (rather than assumed) so legacy dev/test docs enrolled under the old gated
 * model stay inert instead of half-activating. The activation gate is
 * subjects + availability only.
 *
 * "New requests" covers BOTH things awaiting an answer in the study world:
 * pending family contact requests (studyContactRequests — sit has no
 * equivalent step) and pending session bookings (study-sessions). Cards link
 * into /tutor/requests and /tutor/sessions, where the accept/decline actions
 * live — mirroring sit, whose dashboard cards also navigate to the request
 * detail rather than acting inline.
 *
 * INDEX NOTE: both collections are queried by tutorUserId alone (single-field,
 * always indexed) and filtered/sorted client-side — see RequestsPage and
 * SessionsPage for the composite-index rationale. A recurring series' concrete
 * dates live in its `instances` subcollection, which this page must not query —
 * series render their weekly slot line instead of a next date.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  const enrollmentComplete = tutor?.enrollmentComplete ?? false;
  const isSearchable = tutor?.searchable ?? false;
  const hasSubjects = (tutor?.subjects?.length ?? 0) > 0;

  // Availability gate: read the schedules doc directly. A tutor is "available"
  // once any weekly slot is on.
  const [hasSlots, setHasSlots] = useState(false);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleDialog, setToggleDialog] = useState(false);
  // Null while loading — the sections and the empty state must not paint (and
  // then visibly swap) while a snapshot is still in flight.
  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  // A failed FIRST read must not strand the page on the spinner: with no
  // error branch the only recovery is a blur/refocus (throttled 15s). One
  // flag PER load — a shared flag cleared on any success lets the load that
  // worked erase the other one's failure, recreating the eternal spinner
  // this exists to remove (PR #194 review). Only rendered while `loading`,
  // so a refetch blip over rendered sections stays invisible (SessionsPage's
  // loadError pattern).
  const [requestsError, setRequestsError] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);
  const loadError = requestsError || sessionsError;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDoc(doc(db, 'schedules', uid))
      .then((snap) => {
        if (cancelled) return;
        const weekly = (snap.exists() ? snap.data()?.weekly : undefined) as
          | Record<string, boolean[]>
          | undefined;
        const anySlot = weekly
          ? DAYS_OF_WEEK.some((day) => weekly[day]?.some(Boolean))
          : false;
        setHasSlots(anySlot);
        setScheduleLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setScheduleLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // A mounted guard shared by the initial loads and every focus-triggered
  // refetch, so a late-resolving fetch never writes state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadRequests = useCallback(() => {
    if (!uid) return;
    getDocs(query(collection(db, 'studyContactRequests'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (!mountedRef.current) return;
        const rows = snap.docs.map((d) => d.data() as StudyContactRequestDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setRequests(rows);
        setRequestsError(false);
      })
      .catch(() => {
        // A failed read is UNKNOWN, not zero: on first load `requests` stays
        // null (loading rather than a wrong empty state); on a refetch blip
        // the last-known-good rows survive.
        if (mountedRef.current) setRequestsError(true);
      });
  }, [uid]);

  const loadSessions = useCallback(() => {
    if (!uid) return;
    getDocs(query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (!mountedRef.current) return;
        const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setSessions(rows);
        setSessionsError(false);
      })
      .catch(() => {
        /* keep last-known-good state */
        if (mountedRef.current) setSessionsError(true);
      });
  }, [uid]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Issue #117 tier (a): a returning user re-runs the same loads, so an open
  // tab shows fresh sections.
  useRefetchOnFocus(() => {
    loadRequests();
    loadSessions();
  });

  const handleToggleSearchable = async () => {
    if (!uid) return;
    // Guard: activation requires subjects and at least one availability slot.
    if (!isSearchable && !(hasSubjects && hasSlots)) return;
    setToggling(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.searchable': !isSearchable,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setToggleDialog(false);
    } finally {
      setToggling(false);
    }
  };

  if (!tutor) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const canActivate = hasSubjects && hasSlots;

  const slotLine = (slot: RecurringSlot): string =>
    t('tutor.sessions.recurringSlot', {
      day: t(`days.${DAY_FULL[slot.day]}`),
      start: slot.startTime,
      end: slot.endTime,
    });

  const loading = requests === null || sessions === null;
  const today = parisToday();
  const pendingRequests = (requests ?? []).filter((r) => r.status === 'pending');
  // Same date floor as Confirmed below: nothing server-side expires a pending
  // one_time booking, so without it a request the tutor never answered would
  // sit in New Requests forever with a past date (PR #194 review).
  const pendingSessions = (sessions ?? []).filter(
    (s) =>
      s.status === 'pending' &&
      (s.type === 'recurring' || !s.date || s.date >= today),
  );

  // Upcoming confirmed work, interleaved by date (SessionsPage's ordering):
  // one_time sessions from today on, plus confirmed recurring series (their
  // concrete dates live in the instances subcollection this page must not
  // query, so they sort last and show their weekly slot line).
  const confirmedUpcoming = (sessions ?? [])
    .filter(
      (s) =>
        s.status === 'confirmed' &&
        (s.type === 'recurring' || (!!s.date && s.date >= today)),
    )
    .map((s) => ({ s, sortDate: s.type === 'one_time' ? (s.date as string) : '9999-12-31' }))
    .sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0))
    .map((e) => e.s);

  // The amber badge is a to-do count, so tutor-authored proposals (which
  // await the FAMILY's answer) don't count — they still render in the
  // section, marked "awaiting the family" (PR #194 review).
  const newCount =
    // Same rule for contact requests as for sessions (issue #207 PR4): one
    // this tutor SENT by answering a published search awaits the FAMILY, so
    // it is not a to-do — it still renders below, marked.
    pendingRequests.filter((r) => r.initiatedBy !== 'tutor').length +
    pendingSessions.filter((s) => s.proposedBy !== 'provider').length;
  const newTotal = pendingRequests.length + pendingSessions.length;
  const hasAny = newTotal > 0 || confirmedUpcoming.length > 0;

  return (
    <div className="px-5 pt-4 pb-8">
      {/* ── Header: greeting left, search-visibility pill top right — the same
          treatment as sit's babysitter dashboard (owner request, PR #194),
          now literally the same component (parity D1, issue #239). This was
          the one dashboard of the four that greeted nobody: a static "Tutor
          dashboard" title where the other three used the reader's name.
          The pill opens a confirm dialog; while the activation gate (subjects
          + slots) is unmet it renders dimmed and inert, with the amber hint
          card below carrying the explanation. ── */}
      <DashboardGreeting
        firstName={userDoc?.firstName}
        contextLine={t('tutor.dashboard.greeting')}
        action={
          enrollmentComplete && (
            <button
              type="button"
              onClick={() => {
                if (!isSearchable && !canActivate) return;
                setToggleDialog(true);
              }}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                isSearchable
                  ? 'bg-green-100 text-green-700'
                  : canActivate
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-gray-100 text-gray-400 opacity-50'
              }`}
            >
              <div className={`h-2 w-2 rounded-full ${isSearchable ? 'bg-green-500' : 'bg-gray-400'}`} />
              {isSearchable ? t('tutor.dashboard.active') : t('tutor.dashboard.inactive')}
            </button>
          )
        }
      />

      {/* ── Ask-to-supervise prompt (pending claim on guardianLinks/{uid}) ── */}
      <SupervisionRequestCard />

      {/* Install-to-home-screen nudge (browser-tab mode only, issue #162) */}
      <InstallAppBanner />

      {/* ── Activation gate hint (subjects + availability; enrollmentComplete
          is true from creation — the check only fences off legacy docs) ── */}
      {enrollmentComplete && !isSearchable && !canActivate && scheduleLoaded && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <p className="text-xs text-amber-700">
            {!hasSubjects
              ? t('tutor.dashboard.gateNoSubjects')
              : t('tutor.dashboard.gateNoSlots')}
          </p>
        </Card>
      )}

      {/* ── My availability box (sit's babysitter-dashboard treatment) ── */}
      <Link to="/tutor/schedule" className="mb-6 block">
        <Card interactive className="flex items-center gap-3 py-4">
          <CalendarIcon className="h-6 w-6 text-brand-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {t('tutor.dashboard.myAvailability')}
            </p>
            <p className="text-xs text-gray-500">{t('tutor.dashboard.availabilityDesc')}</p>
          </div>
          <ChevronRightIcon className="h-5 w-5 text-gray-400" />
        </Card>
      </Link>

      {/* ── Requests & sessions ── */}
      {loading && loadError ? (
        <p className="py-10 text-center text-sm text-brand-600">
          {t('tutor.dashboard.loadError')}
        </p>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : hasAny ? (
        <>
          <DashboardSection
            title={t('tutor.dashboard.newRequests')}
            count={newCount}
            total={newTotal}
            variant="pending"
          >
            {pendingRequests.map((r) => (
              <Link key={r.requestId} to="/tutor/requests" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                      {/* parentName is '' until a parent answers a request
                          this tutor sent, so don't render an empty line. */}
                      {r.parentName && <p className="text-xs text-gray-500">{r.parentName}</p>}
                      <p className="mt-1 text-xs text-gray-500">
                        {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                      </p>
                      {r.initiatedBy === 'tutor' && (
                        <p className="mt-1 text-xs text-amber-700">
                          {t('tutor.requests.awaitingFamily')}
                        </p>
                      )}
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  </div>
                </Card>
              </Link>
            ))}
            {pendingSessions.map((s) => (
              <Link key={s.sessionId} to="/tutor/sessions" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                      </p>
                      <p className="mt-1 text-xs text-gray-700">
                        {s.type === 'one_time'
                          ? `${formatDateStr(s.date, i18n.language)} · ${s.startTime}${s.endTime ? `–${s.endTime}` : ''}`
                          : s.recurringSlots?.[0]
                            ? slotLine(s.recurringSlots[0])
                            : ''}
                      </p>
                      {s.proposedBy === 'provider' && (
                        <p className="mt-1 text-xs text-amber-700">
                          {t('tutor.sessions.awaitingFamily')}
                        </p>
                      )}
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  </div>
                </Card>
              </Link>
            ))}
          </DashboardSection>

          <DashboardSection
            title={t('tutor.dashboard.confirmed')}
            count={confirmedUpcoming.length}
            variant="confirmed"
          >
            {confirmedUpcoming.map((s) => (
              <Link key={s.sessionId} to="/tutor/sessions" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                      </p>
                      <p className="mt-1 text-xs text-gray-700">
                        {s.type === 'one_time'
                          ? `${formatDateStr(s.date, i18n.language)} · ${s.startTime}${s.endTime ? `–${s.endTime}` : ''}`
                          : s.recurringSlots?.[0]
                            ? slotLine(s.recurringSlots[0])
                            : ''}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.sessions.location.${s.location}`)}
                      </p>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-400" />
                  </div>
                </Card>
              </Link>
            ))}
          </DashboardSection>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <UsersIcon className="h-7 w-7 text-gray-400" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">{t('tutor.dashboard.noRequests')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('tutor.dashboard.noRequestsDesc')}
          </p>
        </div>
      )}

      {/* "Posts from families" — the board's entry point lives on the
          dashboard under the session sections (owner direction on PR #211),
          not behind a menu entry. Renders nothing only while the first
          snapshot is pending — an empty or failed read still shows the title,
          a one-line status and the link, since this is the board's only
          entry point. */}
      <PublishedSearchesPreview />

      {/* ── Search-visibility confirm dialog (sit's babysitter pattern) ── */}
      <Dialog open={toggleDialog} onClose={() => setToggleDialog(false)} ariaLabel={isSearchable ? t('tutor.dashboard.deactivateTitle') : t('tutor.dashboard.activateTitle')}>
        <h3 className="mb-2 text-lg font-bold">
          {isSearchable
            ? t('tutor.dashboard.deactivateTitle')
            : t('tutor.dashboard.activateTitle')}
        </h3>
        <p className="mb-5 text-sm text-gray-600">
          {isSearchable
            ? t('tutor.dashboard.deactivateDesc')
            : t('tutor.dashboard.activateDesc')}
        </p>
        <div className="flex gap-2">
          <Button onClick={handleToggleSearchable} disabled={toggling} className="flex-1">
            {toggling
              ? t('tutor.dashboard.updating')
              : isSearchable
                ? t('tutor.dashboard.deactivate')
                : t('tutor.dashboard.activate')}
          </Button>
          <Button variant="ghost" onClick={() => setToggleDialog(false)} className="flex-1">
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
