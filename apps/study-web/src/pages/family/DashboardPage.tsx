import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import { CrossAppWelcomeCard } from '@/components/family/CrossAppWelcomeCard';
import { InstallAppBanner } from '@/components/ui/InstallAppBanner';
import {
  Card,
  BellIcon,
  CalendarIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  ChevronRightIcon,
  useRefetchOnFocus,
} from '@ejm/shared-ui';

/** The soonest confirmed one_time session, extracted alongside the counts.
 * A recurring series' concrete dates live in its `instances` subcollection,
 * which this page must not query — so the hero only surfaces one_time dates. */
type NextSession = { date: string; startTime: string; tutorName?: string };

/** Paris "YYYY-MM-DD" today (en-CA renders ISO order; tz-correct via runtime). */
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Paris wall-clock "YYYY-MM-DDTHH:MM" — same idiom as SessionsPage, so the
 * hero's "has this session already started" test matches the sessions hub. */
function parisNowStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
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
 * Family dashboard for the Sync/Study portal.
 *
 * The verification gate reads `families/{familyId}.verification.isFullyVerified`
 * DIRECTLY (mirroring how the sit family dashboard loads its family doc). Family
 * identity verification is performed in the Sync/Sit app — the two apps share
 * the same `families` collection — so this portal only READS the flag and, until
 * it is true, keeps tutor search locked and surfaces an explanatory banner. A
 * missing `verification` field is treated as not-verified.
 *
 * Status-first layout (issue #120): a single state-driven hero slot under the
 * verification banner answers "what matters now" (next confirmed session, then
 * accepted requests, then pending requests, then the search CTA), and every
 * other destination is a compact half-weight tile. All hero data derives from
 * the SAME two snapshots that feed the tile counts — no extra queries.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  // null = still loading; true/false once the family doc has resolved.
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  // Live pending/accepted request counts (null while loading).
  const [counts, setCounts] = useState<{ pending: number; accepted: number } | null>(null);
  // Live pending/upcoming session counts plus the soonest confirmed one_time
  // session (null while loading; one setState per snapshot).
  const [sessionData, setSessionData] = useState<{
    pending: number;
    upcoming: number;
    nextSession: NextSession | null;
  } | null>(null);

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
      })
      .catch(() => {
        // A FAILED read is unknown, not unverified: only flip to false when
        // the doc genuinely says so. On a refetch blip a verified family
        // keeps its last-known-good state (and the search CTA); on first
        // load the gate simply stays in its loading state.
      });
  }, [familyId]);

  // Live request counts for the requests tile and the accepted/pending heroes.
  const loadRequestCounts = useCallback(() => {
    if (!familyId) return;
    getDocs(query(collection(db, 'studyContactRequests'), where('familyId', '==', familyId)))
      .then((snap) => {
        if (!mountedRef.current) return;
        let pending = 0;
        let accepted = 0;
        snap.docs.forEach((d) => {
          const status = d.data()?.status;
          if (status === 'pending') pending += 1;
          else if (status === 'accepted') accepted += 1;
        });
        setCounts({ pending, accepted });
      })
      .catch(() => {
        // Keep last-known-good counts: zeroing on a refetch failure is an
        // error masquerading as an empty state.
      });
  }, [familyId]);

  // Live session counts for the sessions tile (equality-only query, counted
  // client-side — mirrors the requests tile) PLUS the next confirmed session
  // for the hero, extracted from the same snapshot.
  const loadSessionData = useCallback(() => {
    if (!familyId) return;
    getDocs(query(collection(db, 'study-sessions'), where('familyId', '==', familyId)))
      .then((snap) => {
        if (!mountedRef.current) return;
        // Time-granular cutoff: a session that finished earlier TODAY must
        // not claim the hero as "Next session · Today" all evening.
        const now = parisNowStamp();
        let pending = 0;
        let upcoming = 0;
        let nextSession: NextSession | null = null;
        snap.docs.forEach((d) => {
          const data = d.data();
          const status = data?.status;
          if (status === 'pending') pending += 1;
          else if (status === 'confirmed') {
            upcoming += 1;
            const date = typeof data?.date === 'string' ? data.date : null;
            const startTime = typeof data?.startTime === 'string' ? data.startTime : '';
            if (data?.type !== 'recurring' && date && `${date}T${startTime}` > now) {
              if (
                !nextSession ||
                date < nextSession.date ||
                (date === nextSession.date && startTime < nextSession.startTime)
              ) {
                nextSession = {
                  date,
                  startTime,
                  tutorName: typeof data?.tutorName === 'string' ? data.tutorName : undefined,
                };
              }
            }
          }
        });
        setSessionData({ pending, upcoming, nextSession });
      })
      .catch(() => {
        // Keep last-known-good counts (see requests counts above).
      });
  }, [familyId]);

  useEffect(() => {
    loadVerification();
  }, [loadVerification]);

  useEffect(() => {
    loadRequestCounts();
  }, [loadRequestCounts]);

  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Issue #117 tier (a): a returning user re-runs the same loads, so an open
  // tab shows fresh verification state and summary counts.
  useRefetchOnFocus(() => {
    loadVerification();
    loadRequestCounts();
    loadSessionData();
  });

  // ── Hero (first match wins). The data-driven states need both snapshots;
  // the search fallback deliberately does NOT — a failed requests read must
  // never make tutor search unreachable (the app bar has no /family/search
  // link; this page is the only way in). A null count can't be > 0, so
  // hoisting the fallback leaves the priority order unchanged; when the
  // snapshots resolve with activity, the swap happens in the same slot.
  // The unverified state is owned by the banner, not the hero. ──
  let hero: { to: string; title: string; desc: string; icon: React.ReactNode } | null = null;
  if (counts !== null && sessionData !== null) {
    if (sessionData.nextSession) {
      const next = sessionData.nextSession;
      const diff = dayDiff(parisToday(), next.date);
      const rel =
        diff <= 0
          ? t('family.dashboard.hero.today')
          : diff === 1
            ? t('family.dashboard.hero.tomorrow')
            : t('family.dashboard.hero.inDays', { count: diff });
      hero = {
        to: '/family/sessions',
        title: t('family.dashboard.hero.nextSession'),
        desc: [rel, formatDateStr(next.date, i18n.language), next.startTime, next.tutorName]
          .filter(Boolean)
          .join(' · '),
        icon: <CalendarIcon className="h-6 w-6 text-brand-600" />,
      };
    } else if (counts.accepted > 0) {
      hero = {
        to: '/family/requests',
        title: t('family.dashboard.hero.accepted', { count: counts.accepted }),
        desc: t('family.dashboard.hero.acceptedDesc'),
        icon: <BellIcon className="h-6 w-6 text-brand-600" />,
      };
    } else if (counts.pending > 0) {
      hero = {
        to: '/family/requests',
        title: t('family.dashboard.hero.pending', { count: counts.pending }),
        desc: t('family.dashboard.hero.pendingDesc'),
        icon: <BellIcon className="h-6 w-6 text-brand-600" />,
      };
    }
  }
  if (!hero && isVerified === true) {
    hero = {
      to: '/family/search',
      title: t('family.dashboard.searchCardTitle'),
      desc: t('family.dashboard.searchCardDesc'),
      icon: <SearchIcon className="h-6 w-6 text-brand-600" />,
    };
  }

  // Tile count lines (null while loading — no empty-state flash).
  const requestsSub =
    counts === null
      ? undefined
      : counts.pending + counts.accepted > 0
        ? `${t('family.dashboard.tiles.requestsPending', { count: counts.pending })} · ${t('family.dashboard.tiles.requestsAccepted', { count: counts.accepted })}`
        : t('family.dashboard.tiles.requestsEmpty');
  const sessionsSub =
    sessionData === null
      ? undefined
      : sessionData.pending + sessionData.upcoming > 0
        ? `${t('family.dashboard.tiles.sessionsPending', { count: sessionData.pending })} · ${t('family.dashboard.tiles.sessionsUpcoming', { count: sessionData.upcoming })}`
        : t('family.dashboard.tiles.sessionsEmpty');

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-5 text-lg font-bold text-gray-900">
        {t('family.dashboard.hello')} {userDoc?.firstName || ''}
      </h1>

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

      {/* ── Hero: the single "what matters now" slot. The aria-label carries
          the desc too — the label REPLACES the content for screen readers,
          and the desc holds the actual date/time/name payload. ── */}
      {hero && (
        <Link to={hero.to} aria-label={`${hero.title} — ${hero.desc}`} className="mb-4 block">
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
        {/* While loading, the hero IS the search fallback (see above), so
            this tile stays hidden then and only appears once a data-driven
            state claims the hero — search always has exactly one entry. */}
        {isVerified === true && hero?.to !== '/family/search' && (
          <DashTile
            to="/family/search"
            icon={<SearchIcon className="h-6 w-6 text-brand-600" />}
            title={t('family.dashboard.searchCardTitle')}
          />
        )}
        <DashTile
          to="/family/requests"
          ariaLabel={t('family.dashboard.viewRequests')}
          icon={<BellIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.requestsTitle')}
          sub={requestsSub}
        />
        <DashTile
          to="/family/sessions"
          icon={<CalendarIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.sessionsTitle')}
          sub={sessionsSub}
        />
        <DashTile
          to="/family/governance"
          icon={<ShieldIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.governance.navTitle')}
        />
        <DashTile
          to="/family/settings"
          icon={<SettingsIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.settingsCard')}
        />
        <DashTile
          to="/family/account"
          icon={<UserIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.accountCard')}
        />
      </div>
    </div>
  );
}

function DashTile({
  to,
  icon,
  title,
  sub,
  ariaLabel,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  ariaLabel?: string;
}) {
  // aria-label REPLACES the content for screen readers, so it must carry the
  // count line too — otherwise "2 pending · 1 accepted" is sighted-only,
  // defeating the point of moving the counts inline.
  const label = [ariaLabel ?? title, sub].filter(Boolean).join(' — ');
  return (
    <Link to={to} aria-label={label} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-2 py-4">
        {icon}
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
      </Card>
    </Link>
  );
}
