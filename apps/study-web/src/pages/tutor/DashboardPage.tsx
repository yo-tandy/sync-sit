import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import { DAYS_OF_WEEK } from '@ejm/shared-core';
import {
  Card,
  Button,
  Spinner,
  CalendarIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  SettingsIcon,
  ShieldIcon,
} from '@ejm/shared-ui';

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
  const { t } = useTranslation();
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
        <Spinner className="h-8 w-8 text-red-600" />
      </div>
    );
  }

  const canActivate = hasSubjects && hasSlots;

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-1 text-lg font-bold text-gray-900">{t('tutor.dashboardTitle')}</h1>
      <p className="mb-5 text-sm text-gray-500">{t('tutor.dashboard.greeting')}</p>

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

      {/* ── Upcoming sessions (empty state — booking not built yet) ── */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('tutor.dashboard.sessionsTitle')}
        </h2>
        <Card>
          <p className="py-4 text-center text-sm text-gray-500">
            {t('tutor.dashboard.noSessions')}
          </p>
        </Card>
      </div>

      {/* ── Entry cards ── */}
      <div className="space-y-3">
        <EntryCard
          to="/tutor/subjects"
          icon={<ClipboardListIcon className="h-6 w-6 text-red-600" />}
          title={t('tutor.dashboard.subjectsCard')}
          desc={t('tutor.dashboard.subjectsCardDesc')}
        />
        <EntryCard
          to="/tutor/schedule"
          icon={<CalendarIcon className="h-6 w-6 text-red-600" />}
          title={t('tutor.dashboard.scheduleCard')}
          desc={t('tutor.dashboard.scheduleCardDesc')}
        />
        <EntryCard
          to="/tutor/account"
          icon={<SettingsIcon className="h-6 w-6 text-red-600" />}
          title={t('tutor.dashboard.accountCard')}
          desc={t('tutor.dashboard.accountCardDesc')}
        />
        <EntryCard
          to="/tutor/verification"
          icon={<ShieldIcon className="h-6 w-6 text-red-600" />}
          title={t('tutor.dashboard.verificationCard')}
          desc={t('tutor.dashboard.verificationCardDesc')}
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
        <p className="mb-3 text-xs text-red-700">{t('tutor.dashboard.bannerRejectedDesc')}</p>
        <Link
          to="/tutor/verification"
          className="inline-flex rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
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
        className="inline-flex rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        {t('tutor.dashboard.bannerNotSubmittedCta')}
      </Link>
    </Banner>
  );
}

const TONE_CLASSES: Record<string, string> = {
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
  red: 'border-red-300 bg-red-50 text-red-800',
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
