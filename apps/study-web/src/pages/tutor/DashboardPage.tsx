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
import { SupervisionRequestCard } from '@/components/tutor/SupervisionRequestCard';
import { InstallAppBanner } from '@/components/ui/InstallAppBanner';
import type { StudySessionDoc } from '@/types/studySession';
import {
  Card,
  Button,
  Spinner,
  Badge,
  CalendarIcon,
  ChevronRightIcon,
  UsersIcon,
  useRefetchOnFocus,
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

// ── Collapsible dashboard section (sit's babysitter-dashboard Section) ──
function Section({
  title,
  count,
  variant,
  children,
}: {
  title: string;
  count: number;
  variant: 'pending' | 'confirmed';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mb-2 flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <Badge variant={variant === 'pending' ? 'amber' : 'green'}>{count}</Badge>
        </div>
        <ChevronRightIcon
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

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
  // Null while loading — the sections and the empty state must not paint (and
  // then visibly swap) while a snapshot is still in flight.
  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);

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
      })
      .catch(() => {
        // A failed read is UNKNOWN, not zero: on first load `requests` stays
        // null (loading rather than a wrong empty state); on a refetch blip
        // the last-known-good rows survive.
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
      })
      .catch(() => {
        /* keep last-known-good state */
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
  const pendingRequests = (requests ?? []).filter((r) => r.status === 'pending');
  const pendingSessions = (sessions ?? []).filter((s) => s.status === 'pending');
  const today = parisToday();

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

  const newCount = pendingRequests.length + pendingSessions.length;
  const hasAny = newCount > 0 || confirmedUpcoming.length > 0;

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-1 text-lg font-bold text-gray-900">{t('tutor.dashboardTitle')}</h1>
      <p className="mb-5 text-sm text-gray-500">{t('tutor.dashboard.greeting')}</p>

      {/* ── Ask-to-supervise prompt (pending claim on guardianLinks/{uid}) ── */}
      <SupervisionRequestCard />

      {/* Install-to-home-screen nudge (browser-tab mode only, issue #162) */}
      <InstallAppBanner />

      {/* ── Activation (subjects + availability gate; enrollmentComplete is
          true from creation — the check only fences off legacy docs) ── */}
      {enrollmentComplete && (
        <Card className="mb-4">
          <p className="mb-1 text-sm font-semibold text-gray-900">
            {t('tutor.dashboard.searchTitle')}
          </p>
          <p
            className={`mb-3 text-sm ${isSearchable ? 'text-green-700' : 'text-gray-500'}`}
          >
            {isSearchable
              ? t('tutor.dashboard.searchableLive')
              : t('tutor.dashboard.searchableHidden')}
          </p>

          {!isSearchable && !canActivate && scheduleLoaded && (
            <p className="mb-3 text-xs text-amber-700">
              {!hasSubjects
                ? t('tutor.dashboard.gateNoSubjects')
                : t('tutor.dashboard.gateNoSlots')}
            </p>
          )}

          <Button
            size="sm"
            variant={isSearchable ? 'outline' : 'primary'}
            onClick={handleToggleSearchable}
            disabled={toggling || (!isSearchable && !canActivate)}
          >
            {toggling
              ? t('tutor.dashboard.updating')
              : isSearchable
                ? t('tutor.dashboard.deactivate')
                : t('tutor.dashboard.activate')}
          </Button>
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
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : hasAny ? (
        <>
          <Section title={t('tutor.dashboard.newRequests')} count={newCount} variant="pending">
            {pendingRequests.map((r) => (
              <Link key={r.requestId} to="/tutor/requests" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                      <p className="text-xs text-gray-500">{r.parentName}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                      </p>
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
          </Section>

          <Section
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
          </Section>
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
    </div>
  );
}
