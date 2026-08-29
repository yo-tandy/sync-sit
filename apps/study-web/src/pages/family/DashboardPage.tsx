import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile, hasFamilyMembership } from '@ejm/shared-core';
import type { StudyContactRequestDoc } from '@ejm/study-core';
import type { RecurringSlot } from '@ejm/shared-core';
import type { StudySessionDoc } from '@/types/studySession';
import { CrossAppWelcomeCard } from '@/components/family/CrossAppWelcomeCard';
import { InstallAppBanner } from '@/components/ui/InstallAppBanner';
import {
  Card,
  Button,
  Badge,
  Spinner,
  SearchIcon,
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
 * Family dashboard for the Sync/Study portal.
 *
 * The verification gate reads `families/{familyId}.verification.isFullyVerified`
 * DIRECTLY (mirroring how the sit family dashboard loads its family doc). Family
 * identity verification is performed in the Sync/Sit app — the two apps share
 * the same `families` collection — so this portal only READS the flag and, until
 * it is true, keeps tutor search locked and surfaces an explanatory banner. A
 * missing `verification` field is treated as not-verified.
 *
 * LAYOUT (issue #338, owner request): the parent landing page is the tutor
 * dashboard's layout with the parent's data in it — a single "Find a tutor"
 * button, then a "Your requests" section and a "Your sessions" section, each a
 * collapsible header with a to-do badge over real rows. This REPLACES the
 * status-first hero + tile grid of issue #120: the hero said "you have 2
 * pending requests" above a tile that said "2 pending", and the sections now
 * say it once by simply showing the two requests. The destinations that were
 * half-weight tiles (governance, family settings, account) all have hamburger
 * menu entries — see FamilyAppBar — so nothing became unreachable; search does
 * NOT, which is why its button is unconditional for a verified family rather
 * than a state that can lose a priority race.
 *
 * Rows navigate to /family/requests and /family/sessions, where the
 * accept/decline/cancel actions live — the same rule the two provider
 * dashboards follow, so no callable is invoked from a landing page.
 *
 * INDEX NOTE: both collections are queried by familyId alone (single-field,
 * always indexed) and filtered/sorted client-side. A recurring series' concrete
 * dates live in its `instances` subcollection, which this page must not query —
 * series render their weekly slot line instead of a date.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  // null = still loading; true/false once the family doc has resolved.
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [familyName, setFamilyName] = useState<string | null>(null);
  // Null while loading — the sections and the empty state must not paint (and
  // then visibly swap) while a snapshot is still in flight.
  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  // A failed FIRST read must not strand the page on the spinner. One flag PER
  // load — a shared flag cleared on any success lets the load that worked
  // erase the other one's failure (the tutor dashboard's rule, PR #194
  // review). Only rendered while `loading`, so a refetch blip over rendered
  // sections stays invisible.
  const [requestsError, setRequestsError] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);
  const loadError = requestsError || sessionsError;

  // A mounted guard shared by the initial loads and every focus-triggered
  // refetch, so a late-resolving fetch never writes state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The verification gate read. A parent always has a familyId; if it is
  // somehow absent we leave the gate in its loading state (neither banner nor
  // CTA) rather than assuming a state.
  const loadVerification = useCallback(() => {
    if (!familyId) return;
    getDoc(doc(db, 'families', familyId))
      .then((snap) => {
        if (!mountedRef.current) return;
        const verified = snap.exists()
          ? snap.data()?.verification?.isFullyVerified === true
          : false;
        setIsVerified(verified);
        // The greeting's context line (parity D1, issue #239) — read off the
        // snapshot this gate already fetches, so the header costs no extra
        // request. Absent name leaves the line off entirely.
        setFamilyName(snap.exists() ? (snap.data()?.familyName as string | undefined) ?? null : null);
      })
      .catch(() => {
        // A FAILED read is unknown, not unverified: only flip to false when
        // the doc genuinely says so. On a refetch blip a verified family
        // keeps its last-known-good state (and the search button); on first
        // load the gate simply stays in its loading state.
      });
  }, [familyId]);

  const loadRequests = useCallback(() => {
    if (!familyId) return;
    getDocs(query(collection(db, 'studyContactRequests'), where('familyId', '==', familyId)))
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
  }, [familyId]);

  const loadSessions = useCallback(() => {
    if (!familyId) return;
    getDocs(query(collection(db, 'study-sessions'), where('familyId', '==', familyId)))
      .then((snap) => {
        if (!mountedRef.current) return;
        const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setSessions(rows);
        setSessionsError(false);
      })
      .catch(() => {
        /* keep last-known-good state (see requests above) */
        if (mountedRef.current) setSessionsError(true);
      });
  }, [familyId]);

  useEffect(() => {
    loadVerification();
  }, [loadVerification]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Issue #117 tier (a): a returning user re-runs the same loads, so an open
  // tab shows fresh verification state and sections.
  useRefetchOnFocus(() => {
    loadVerification();
    loadRequests();
    loadSessions();
  });

  // ── Family-less parent (issue #293): after removeCoParent (performed in
  // the Sync/Sit app — the two apps share the same user doc) the removed
  // co-parent keeps their parent profile, so the guard still routes them
  // here, but familyId is gone: every load above no-ops and the dashboard
  // renders empty with no explanation. Say what the state is and point at
  // the recovery paths — a fresh invite link (accepted in Sync/Sit, where
  // the join flow lives) or enrolling a new family here. Membership, not
  // profile presence: a legacy Plan C doc (root familyId) is an active
  // member and must never see this. ──
  if (!hasFamilyMembership(userDoc)) {
    return (
      <div className="px-5 pt-4 pb-8" data-page-width="wide">
        <DashboardGreeting firstName={userDoc?.firstName} />
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <p className="mb-1 text-sm font-semibold">{t('family.dashboard.noFamilyTitle')}</p>
          <p className="mb-2 text-xs text-amber-700">{t('family.dashboard.noFamilyDesc')}</p>
          <p className="mb-3 text-xs text-amber-700">{t('family.dashboard.noFamilyInviteHint')}</p>
          <Link to="/enroll/parent" className="text-xs font-semibold text-amber-900 underline">
            {t('family.dashboard.noFamilyEnrollCta')}
          </Link>
        </div>
      </div>
    );
  }

  const slotLine = (slot: RecurringSlot): string =>
    t('family.sessions.recurringSlot', {
      day: t(`days.${DAY_FULL[slot.day]}`),
      start: slot.startTime,
      end: slot.endTime,
    });

  // Spinner only while a real fetch is in flight. With no familyId there is
  // nothing to load — a legacy Plan C doc carries membership at the doc root,
  // not on the parent profile — so fall through to the empty state instead of
  // spinning forever (RequestsPage's rule).
  const loading = familyId !== null && (requests === null || sessions === null);
  const today = parisToday();

  // ── Your requests: the rows still in play. Declined/cancelled history
  // stays on /family/requests — a landing page shows what is live. ──
  const activeRequests = (requests ?? []).filter(
    (r) => r.status === 'pending' || r.status === 'accepted',
  );
  // The badge is a TO-DO count, so our own pending requests (which await the
  // TUTOR) don't count — they still render, marked "waiting for the tutor".
  // Only a request a tutor opened by answering our published search asks
  // something of this family (issue #207 PR4).
  const requestsTodo = activeRequests.filter(
    (r) => r.status === 'pending' && r.initiatedBy === 'tutor',
  ).length;

  // ── Your sessions: pending bookings plus upcoming confirmed work. Same
  // date floor on both — nothing server-side expires a pending one_time
  // booking, so without it an unanswered request would sit here forever with
  // a past date (the tutor dashboard's rule). ──
  const activeSessions = (sessions ?? [])
    .filter(
      (s) =>
        (s.status === 'pending' || s.status === 'confirmed') &&
        (s.type === 'recurring' || (!!s.date && s.date >= today)),
    )
    .map((s) => ({ s, sortDate: s.type === 'one_time' ? (s.date as string) : '9999-12-31' }))
    .sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0))
    .map((e) => e.s);
  // A tutor PROPOSAL is ours to answer; a booking we sent awaits the tutor.
  const sessionsTodo = activeSessions.filter(
    (s) => s.status === 'pending' && s.proposedBy === 'provider',
  ).length;

  const hasAny = activeRequests.length > 0 || activeSessions.length > 0;

  const sessionWhen = (s: StudySessionDoc): string =>
    s.type === 'one_time'
      ? `${formatDateStr(s.date, i18n.language)} · ${s.startTime}${s.endTime ? `–${s.endTime}` : ''}`
      : s.recurringSlots?.[0]
        ? slotLine(s.recurringSlots[0])
        : '';

  return (
    // Wide desktop tier (issue #119): the sections want the 5xl cap.
    <div className="px-5 pt-4 pb-8" data-page-width="wide">
      {/* Header — the shared idiom (parity D1, issue #239). */}
      <DashboardGreeting
        firstName={userDoc?.firstName}
        contextLine={familyName ? `${familyName.toUpperCase()} ${t('family.dashboard.family')}` : undefined}
      />

      {/* One-time cross-app welcome (issue #144) */}
      <CrossAppWelcomeCard />

      {/* Install-to-home-screen nudge (browser-tab mode only, issue #162) */}
      <InstallAppBanner />

      {/* ── Verification gate (read from the shared families doc). The CTA
          opens the in-app verification page (issue #129) — the flow is shared
          with sit but lives in the current app. ── */}
      {isVerified === false && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <p className="mb-1 text-sm font-semibold">{t('family.dashboard.verifyBannerTitle')}</p>
          <p className="mb-3 text-xs text-amber-700">{t('family.dashboard.verifyBannerDesc')}</p>
          <Link to="/family/verification" className="text-xs font-semibold text-amber-900 underline">
            {t('family.dashboard.verifyBannerCta')}
          </Link>
        </div>
      )}

      {/* ── Find a tutor: the page's one button, and the ONLY way into search
          (FamilyAppBar has no /family/search entry) — so it never depends on
          a snapshot that can fail. Sit's family landing has the same one. ── */}
      {isVerified === true && (
        <Link to="/family/search" className="mb-6 block">
          <Button className="h-14 text-lg">
            <SearchIcon className="h-5 w-5" />
            {t('family.dashboard.searchCardTitle')}
          </Button>
        </Link>
      )}

      {/* ── The two sections (issue #338) ── */}
      {loading && loadError ? (
        <p className="py-10 text-center text-sm text-brand-600">
          {t('family.dashboard.loadError')}
        </p>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : hasAny ? (
        <>
          <DashboardSection
            title={t('family.dashboard.requestsTitle')}
            count={requestsTodo}
            total={activeRequests.length}
            variant="pending"
          >
            {activeRequests.map((r) => (
              <Link key={r.requestId} to="/family/requests" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{r.tutorName}</p>
                        <Badge variant={r.status === 'accepted' ? 'green' : 'amber'}>
                          {t(`family.requests.status.${r.status}`)}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                      </p>
                      {r.status === 'pending' && (
                        <p className="mt-1 text-xs text-amber-700">
                          {r.initiatedBy === 'tutor'
                            ? t('family.requests.answeredPublishedSearch')
                            : t('family.dashboard.awaitingTutorReply')}
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
            title={t('family.dashboard.sessionsTitle')}
            count={sessionsTodo}
            total={activeSessions.length}
            variant="confirmed"
          >
            {activeSessions.map((s) => (
              <Link key={s.sessionId} to="/family/sessions" className="block">
                <Card interactive>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{s.tutorName}</p>
                        <Badge variant={s.status === 'confirmed' ? 'green' : 'amber'}>
                          {s.status === 'confirmed'
                            ? t('family.dashboard.statusConfirmed')
                            : t('family.dashboard.statusPending')}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                      </p>
                      <p className="mt-1 text-xs text-gray-700">{sessionWhen(s)}</p>
                      {s.status === 'pending' && (
                        <p className="mt-1 text-xs text-amber-700">
                          {s.proposedBy === 'provider'
                            ? t('family.sessions.proposedBy', { name: s.tutorName })
                            : t('family.sessions.awaitingTutor')}
                        </p>
                      )}
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
          <h3 className="mb-2 text-lg font-semibold">{t('family.dashboard.emptyTitle')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('family.dashboard.emptyDesc')}
          </p>
        </div>
      )}
    </div>
  );
}
