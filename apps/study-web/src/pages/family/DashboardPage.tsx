import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import {
  Card,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  ChevronRightIcon,
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
 * Requests are a placeholder here: real request data is wired in PR C alongside
 * the tutor-search page that currently lives behind the /family/search stub.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  // null = still loading; true/false once the family doc has resolved.
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  useEffect(() => {
    // A parent always has a familyId; if it is somehow absent we leave the gate
    // in its loading state (neither banner nor CTA) rather than assuming a state.
    if (!familyId) return;
    let cancelled = false;
    getDoc(doc(db, 'families', familyId))
      .then((snap) => {
        if (cancelled) return;
        const verified = snap.exists()
          ? snap.data()?.verification?.isFullyVerified === true
          : false;
        setIsVerified(verified);
      })
      .catch(() => {
        if (!cancelled) setIsVerified(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

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
            <SearchIcon className="h-6 w-6 text-red-600" />
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

      {/* ── Requests summary (placeholder — real data lands in PR C) ── */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('family.dashboard.requestsTitle')}
        </h2>
        <Card>
          <p className="py-4 text-center text-sm text-gray-500">
            {t('family.dashboard.noRequests')}
          </p>
        </Card>
      </div>

      {/* ── Entry cards ── */}
      <div className="space-y-3">
        <EntryCard
          to="/family/settings"
          icon={<SettingsIcon className="h-6 w-6 text-red-600" />}
          title={t('family.dashboard.settingsCard')}
          desc={t('family.dashboard.settingsCardDesc')}
        />
        <EntryCard
          to="/family/account"
          icon={<UserIcon className="h-6 w-6 text-red-600" />}
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
