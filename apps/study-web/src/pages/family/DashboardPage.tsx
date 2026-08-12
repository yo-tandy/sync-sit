import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import {
  Card,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  ChevronRightIcon,
  useRefetchOnFocus,
} from '@ejm/shared-ui';

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
 * The requests summary shows live pending/accepted counts from
 * `studyContactRequests` (where familyId==mine) and links to /family/requests.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  // null = still loading; true/false once the family doc has resolved.
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  // Live pending/accepted request counts (null while loading).
  const [counts, setCounts] = useState<{ pending: number; accepted: number } | null>(null);
  // Live pending/upcoming session counts (null while loading).
  const [sessionCounts, setSessionCounts] = useState<{ pending: number; upcoming: number } | null>(
    null,
  );

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

  // Live request counts for the summary card.
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

  // Live session counts for the sessions summary card (equality-only query,
  // counted client-side — mirrors the requests card).
  const loadSessionCounts = useCallback(() => {
    if (!familyId) return;
    getDocs(query(collection(db, 'study-sessions'), where('familyId', '==', familyId)))
      .then((snap) => {
        if (!mountedRef.current) return;
        let pending = 0;
        let upcoming = 0;
        snap.docs.forEach((d) => {
          const status = d.data()?.status;
          if (status === 'pending') pending += 1;
          else if (status === 'confirmed') upcoming += 1;
        });
        setSessionCounts({ pending, upcoming });
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
    loadSessionCounts();
  }, [loadSessionCounts]);

  // Issue #117 tier (a): a returning user re-runs the same loads, so an open
  // tab shows fresh verification state and summary counts.
  useRefetchOnFocus(() => {
    loadVerification();
    loadRequestCounts();
    loadSessionCounts();
  });

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-1 text-lg font-bold text-gray-900">
        {t('family.dashboard.hello')} {userDoc?.firstName || ''} 👋
      </h1>
      <p className="mb-5 text-sm text-gray-500">{t('family.dashboard.greeting')}</p>

      {/* ── Verification gate (read from the shared families doc) ── */}
      {isVerified === false && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <p className="mb-1 text-sm font-semibold">{t('family.dashboard.verifyBannerTitle')}</p>
          <p className="text-xs text-amber-700">{t('family.dashboard.verifyBannerDesc')}</p>
        </div>
      )}

      {/* ── Find-a-tutor CTA (verified families only — search is gated) ── */}
      {isVerified === true && (
        <Link to="/family/search" className="mb-4 block">
          <Card interactive className="flex items-center gap-3 py-4">
            <SearchIcon className="h-6 w-6 text-brand-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">
                {t('family.dashboard.searchCardTitle')}
              </p>
              <p className="text-xs text-gray-500">{t('family.dashboard.searchCardDesc')}</p>
            </div>
            <ChevronRightIcon className="h-5 w-5 text-gray-400" />
          </Card>
        </Link>
      )}

      {/* ── Requests summary (live counts → /family/requests) ── */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('family.dashboard.requestsTitle')}
        </h2>
        <Link
          to="/family/requests"
          aria-label={t('family.dashboard.viewRequests')}
          className="block"
        >
          <Card interactive>
            {counts === null ? (
              // Counts still loading — render the card without a body rather than
              // flashing the empty message before data resolves.
              <div className="py-4" />
            ) : counts.pending + counts.accepted > 0 ? (
              <div className="flex items-center gap-6 py-2">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{counts.pending}</p>
                  <p className="text-xs text-gray-500">{t('family.dashboard.requestsPending')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{counts.accepted}</p>
                  <p className="text-xs text-gray-500">{t('family.dashboard.requestsAccepted')}</p>
                </div>
                <ChevronRightIcon className="ml-auto h-5 w-5 text-gray-400" />
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-gray-500">
                {t('family.dashboard.noRequests')}
              </p>
            )}
          </Card>
        </Link>
      </div>

      {/* ── Sessions summary (live counts → /family/sessions) ── */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('family.dashboard.sessionsTitle')}
        </h2>
        <Link
          to="/family/sessions"
          aria-label={t('family.dashboard.sessionsTitle')}
          className="block"
        >
          <Card interactive>
            {sessionCounts === null ? (
              <div className="py-4" />
            ) : sessionCounts.pending + sessionCounts.upcoming > 0 ? (
              <div className="flex items-center gap-6 py-2">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{sessionCounts.pending}</p>
                  <p className="text-xs text-gray-500">{t('family.dashboard.sessionsPending')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{sessionCounts.upcoming}</p>
                  <p className="text-xs text-gray-500">{t('family.dashboard.sessionsUpcoming')}</p>
                </div>
                <ChevronRightIcon className="ml-auto h-5 w-5 text-gray-400" />
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-gray-500">
                {t('family.dashboard.noSessions')}
              </p>
            )}
          </Card>
        </Link>
      </div>

      {/* ── Entry cards ── */}
      <div className="space-y-3">
        <EntryCard
          to="/family/governance"
          icon={<ShieldIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.governance.navTitle')}
          desc={t('family.governance.navDesc')}
        />
        <EntryCard
          to="/family/settings"
          icon={<SettingsIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.settingsCard')}
          desc={t('family.dashboard.settingsCardDesc')}
        />
        <EntryCard
          to="/family/account"
          icon={<UserIcon className="h-6 w-6 text-brand-600" />}
          title={t('family.dashboard.accountCard')}
          desc={t('family.dashboard.accountCardDesc')}
        />
      </div>
    </div>
  );
}

function EntryCard({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className="block">
      <Card interactive className="flex items-center gap-3 py-4">
        {icon}
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
      </Card>
    </Link>
  );
}
