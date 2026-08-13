import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import { DAYS_OF_WEEK } from '@ejm/shared-core';
import { SupervisionRequestCard } from '@/components/tutor/SupervisionRequestCard';
import {
  Card,
  Button,
  Spinner,
  Badge,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  SettingsIcon,
  ShieldIcon,
  useRefetchOnFocus,
} from '@ejm/shared-ui';

/** The tutor's soonest confirmed one_time session, extracted alongside the
 * pending count. A recurring series' concrete dates live in its `instances`
 * subcollection, which this page must not query — one_time dates only. */
type NextSession = { id: string; date: string; startTime: string; familyName?: string };

/** Paris "YYYY-MM-DD" today (en-CA renders ISO order; tz-correct via runtime). */
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Whole-day difference between two "YYYY-MM-DD" strings, parsed field-by-field
 * (never `new Date(str)`, which reads as UTC midnight and can slip a day). */
function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000,
  );
}

/** Format a "YYYY-MM-DD" date field-by-field (see dayDiff on parsing). */
function formatDateStr(s: string, lang: string): string {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Tutor dashboard — the consumer of PR #77's state contract. The banner is
 * keyed on `verification.identityStatus`; liveness/search is keyed on the
 * profile's `enrollmentComplete`. They are INDEPENDENT (see the plan's state
 * table) — never derive one from the other. A missing `verification` field
 * (pre-#77 tutors) is treated as `not_submitted`.
 *
 * Rejection reasons live on the verification DOCUMENT (not the profile), so the
 * rejected banner links to /tutor/verification — which already surfaces the
 * reason — rather than fetching the document here.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  const identityStatus = tutor?.verification?.identityStatus ?? 'not_submitted';
  const enrollmentComplete = tutor?.enrollmentComplete ?? false;
  const isSearchable = tutor?.searchable ?? false;
  const hasSubjects = (tutor?.subjects?.length ?? 0) > 0;

  // Availability gate: read the schedules doc directly (the useSchedule hook is
  // copied in a later task). A tutor is "available" once any weekly slot is on.
  const [hasSlots, setHasSlots] = useState(false);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  // Pending-session count plus the next confirmed session for the hero (one
  // setState per snapshot).
  const [sessionData, setSessionData] = useState<{ pending: number; next: NextSession | null }>({
    pending: 0,
    next: null,
  });
  const [pendingEndorsements, setPendingEndorsements] = useState(0);

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

  // A mounted guard shared by the initial count loads and every
  // focus-triggered refetch, so a late-resolving fetch never writes state
  // after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Pending contact-request count for the inbox card. Queried by tutorUserId
  // only (single-field index) and counted client-side — see RequestsPage for
  // the index rationale.
  const loadRequestCount = useCallback(() => {
    if (!uid) return;
    getDocs(query(collection(db, 'studyContactRequests'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (!mountedRef.current) return;
        setPendingRequests(snap.docs.filter((d) => d.data()?.status === 'pending').length);
      })
      .catch(() => {
        /* leave count at 0 */
      });
  }, [uid]);

  // Pending-session count for the sessions tile PLUS the tutor's next confirmed
  // session for the hero, extracted from the same snapshot. Queried by
  // tutorUserId only (single-field index) and counted client-side — see
  // SessionsPage for the index rationale.
  const loadSessionData = useCallback(() => {
    if (!uid) return;
    getDocs(query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (!mountedRef.current) return;
        const today = parisToday();
        let pending = 0;
        let next: NextSession | null = null;
        snap.docs.forEach((d) => {
          const data = d.data();
          const status = data?.status;
          if (status === 'pending') pending += 1;
          else if (status === 'confirmed') {
            const date = typeof data?.date === 'string' ? data.date : null;
            const startTime = typeof data?.startTime === 'string' ? data.startTime : '';
            if (data?.type !== 'recurring' && date && date >= today) {
              if (
                !next ||
                date < next.date ||
                (date === next.date && startTime < next.startTime)
              ) {
                next = { id: d.id, date, startTime, familyName: data?.familyName };
              }
            }
          }
        });
        setSessionData({ pending, next });
      })
      .catch(() => {
        /* keep last-known-good state */
      });
  }, [uid]);

  // Pending-endorsement count for the endorsements card. Endorsements live in
  // the shared `references` collection keyed by tutorUserId; count status
  // 'private' (awaiting the tutor) client-side. (Sit references are keyed by
  // babysitterUserId, so this query never sees them.)
  const loadEndorsementCount = useCallback(() => {
    if (!uid) return;
    getDocs(query(collection(db, 'references'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (!mountedRef.current) return;
        setPendingEndorsements(snap.docs.filter((d) => d.data()?.status === 'private').length);
      })
      .catch(() => {
        /* leave count at 0 */
      });
  }, [uid]);

  useEffect(() => {
    loadRequestCount();
  }, [loadRequestCount]);

  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  useEffect(() => {
    loadEndorsementCount();
  }, [loadEndorsementCount]);

  // Issue #117 tier (a): a returning user re-runs the same count loads, so an
  // open tab shows fresh inbox/session/endorsement badges.
  useRefetchOnFocus(() => {
    loadRequestCount();
    loadSessionData();
    loadEndorsementCount();
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

  // ── Hero (first match wins; issue #120). Requests lead because a waiting
  // family is blocked on the tutor's answer; then sessions to confirm; then
  // the next confirmed session. Zero-state has no hero — the verification
  // banner / activation card already lead. ──
  let hero: { to: string; title: string; desc: string; icon: React.ReactNode } | null = null;
  if (pendingRequests > 0) {
    hero = {
      to: '/tutor/requests',
      title: t('tutor.dashboard.hero.pendingRequests', { count: pendingRequests }),
      desc: t('tutor.dashboard.hero.pendingRequestsDesc'),
      icon: <BellIcon className="h-6 w-6 text-brand-600" />,
    };
  } else if (sessionData.pending > 0) {
    hero = {
      to: '/tutor/sessions',
      title: t('tutor.dashboard.hero.pendingSessions', { count: sessionData.pending }),
      desc: t('tutor.dashboard.hero.pendingSessionsDesc'),
      icon: <CalendarIcon className="h-6 w-6 text-brand-600" />,
    };
  } else if (sessionData.next) {
    const next = sessionData.next;
    const diff = dayDiff(parisToday(), next.date);
    const rel =
      diff <= 0
        ? t('tutor.dashboard.hero.today')
        : diff === 1
          ? t('tutor.dashboard.hero.tomorrow')
          : t('tutor.dashboard.hero.inDays', { count: diff });
    hero = {
      to: '/tutor/sessions',
      title: t('tutor.dashboard.hero.nextSession'),
      desc: [rel, formatDateStr(next.date, i18n.language), next.startTime, next.familyName]
        .filter(Boolean)
        .join(' · '),
      icon: <CalendarIcon className="h-6 w-6 text-brand-600" />,
    };
  }

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-1 text-lg font-bold text-gray-900">{t('tutor.dashboardTitle')}</h1>
      <p className="mb-5 text-sm text-gray-500">{t('tutor.dashboard.greeting')}</p>

      {/* ── Ask-to-supervise prompt (pending claim on guardianLinks/{uid}) ── */}
      <SupervisionRequestCard />

      {/* ── Verification-state banner (keyed on identityStatus + liveness) ── */}
      <VerificationBanner
        identityStatus={identityStatus}
        enrollmentComplete={enrollmentComplete}
        t={t}
      />

      {/* ── Activation (approved + enrolled only) ── */}
      {identityStatus === 'approved' && enrollmentComplete && (
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

      {/* ── Hero: the single "what matters now" slot ── */}
      {hero && (
        <Link to={hero.to} aria-label={hero.title} className="mb-4 block">
          <Card interactive className="flex items-center gap-3 border-brand-200 bg-brand-50 py-4">
            {hero.icon}
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-gray-900">{hero.title}</p>
              <p className="text-sm text-gray-600">{hero.desc}</p>
            </div>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-500" />
          </Card>
        </Link>
      )}

      {/* ── Everything else: compact half-weight tiles ── */}
      <div className="grid grid-cols-2 gap-3">
        <DashTile
          to="/tutor/requests"
          icon={<BellIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.requestsCardTitle')}
          badge={pendingRequests > 0 ? <Badge variant="red">{pendingRequests}</Badge> : undefined}
        />
        <DashTile
          to="/tutor/sessions"
          icon={<CalendarIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.sessionsCardTitle')}
          badge={
            sessionData.pending > 0 ? <Badge variant="red">{sessionData.pending}</Badge> : undefined
          }
          sub={
            sessionData.pending === 0 && !sessionData.next
              ? t('tutor.dashboard.tiles.sessionsEmpty')
              : undefined
          }
        />
        <DashTile
          to="/tutor/endorsements"
          icon={<CheckIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.endorsementsCardTitle')}
          badge={
            pendingEndorsements > 0 ? <Badge variant="red">{pendingEndorsements}</Badge> : undefined
          }
        />
        <DashTile
          to="/tutor/subjects"
          icon={<ClipboardListIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.subjectsCard')}
        />
        <DashTile
          to="/tutor/schedule"
          icon={<CalendarIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.scheduleCard')}
        />
        <DashTile
          to="/tutor/account"
          icon={<SettingsIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.accountCard')}
        />
        <DashTile
          to="/tutor/verification"
          icon={<ShieldIcon className="h-6 w-6 text-brand-600" />}
          title={t('tutor.dashboard.verificationCard')}
        />
      </div>
    </div>
  );
}

function VerificationBanner({
  identityStatus,
  enrollmentComplete,
  t,
}: {
  identityStatus: string;
  enrollmentComplete: boolean;
  t: (key: string) => string;
}) {
  // pending has two treatments split by liveness (state-contract rows 2 & 5).
  if (identityStatus === 'pending' && enrollmentComplete) {
    return (
      <Banner tone="amber" title={t('tutor.dashboard.bannerPendingLiveTitle')}>
        <p className="text-xs text-amber-700">{t('tutor.dashboard.bannerPendingLiveDesc')}</p>
      </Banner>
    );
  }
  if (identityStatus === 'pending') {
    return (
      <Banner tone="amber" title={t('tutor.dashboard.bannerPendingTitle')}>
        <p className="text-xs text-amber-700">{t('tutor.dashboard.bannerPendingDesc')}</p>
      </Banner>
    );
  }
  if (identityStatus === 'rejected') {
    return (
      <Banner tone="red" title={t('tutor.dashboard.bannerRejectedTitle')}>
        <p className="mb-3 text-xs text-brand-700">{t('tutor.dashboard.bannerRejectedDesc')}</p>
        <Link
          to="/tutor/verification"
          className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
        >
          {t('tutor.dashboard.bannerRejectedCta')}
        </Link>
      </Banner>
    );
  }
  if (identityStatus === 'approved' && enrollmentComplete) {
    return (
      <Banner tone="green" title={t('tutor.dashboard.bannerApprovedTitle')}>
        <p className="text-xs text-green-700">{t('tutor.dashboard.bannerApprovedDesc')}</p>
      </Banner>
    );
  }
  // not_submitted (incl. absent verification / pre-#77 tutors)
  return (
    <Banner tone="gray" title={t('tutor.dashboard.bannerNotSubmittedTitle')}>
      <p className="mb-3 text-xs text-gray-600">{t('tutor.dashboard.bannerNotSubmittedDesc')}</p>
      <Link
        to="/tutor/verification"
        className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
      >
        {t('tutor.dashboard.bannerNotSubmittedCta')}
      </Link>
    </Banner>
  );
}

const TONE_CLASSES: Record<string, string> = {
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
  red: 'border-brand-300 bg-brand-50 text-brand-800',
  green: 'border-green-300 bg-green-50 text-green-800',
  gray: 'border-gray-300 bg-gray-50 text-gray-800',
};

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'amber' | 'red' | 'green' | 'gray';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mb-4 rounded-xl border p-4 ${TONE_CLASSES[tone]}`}>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

function DashTile({
  to,
  icon,
  title,
  sub,
  badge,
  ariaLabel,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  badge?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Link to={to} aria-label={ariaLabel ?? title} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-2 py-4">
        <div className="flex items-start justify-between">
          {icon}
          {badge}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
      </Card>
    </Link>
  );
}
