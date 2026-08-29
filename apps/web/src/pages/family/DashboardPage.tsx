import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Button, Badge, Card, SkeletonCard, Input, InstallAppBanner } from '@/components/ui';
import { CalendarIcon, ChevronRightIcon, PlusIcon, SearchIcon } from '@/components/ui/Icons';
import type { AppointmentDoc, RecurringSlot } from '@ejm/sit-core';
import { getParentProfile } from '@ejm/sit-core';
import { hasFamilyMembership } from '@ejm/shared-core';
import { useRefetchOnFocus, DashboardGreeting, DashboardSection } from '@ejm/shared-ui';
import { formatFamilyTitle } from '@/lib/formatName';
import { parisNowStamp } from '@/lib/appointmentTime';
import { CrossAppWelcomeCard } from '@/components/family/CrossAppWelcomeCard';

/** Soonest-first ordering for a section's rows. A recurring appointment has no
 * single date (its occurrences are derived from `recurringSlots`), so it sorts
 * last rather than pretending to a position in the calendar. */
function bySoonest(a: AppointmentDoc, b: AppointmentDoc): number {
  const ka = a.date ? `${a.date}T${a.startTime || '00:00'}` : '9999-12-31';
  const kb = b.date ? `${b.date}T${b.startTime || '00:00'}` : '9999-12-31';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function FamilyDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const { userDoc } = useAuthStore();
  const { familyVerification, fetchStatus: fetchVerificationStatus } = useVerificationStore();
  const [familyName, setFamilyName] = useState('');
  const [kids, setKids] = useState<{ kidId: string; firstName: string; age: number }[]>([]);
  const [kidsLoaded, setKidsLoaded] = useState(false);
  const [newKidName, setNewKidName] = useState('');
  const [newKidAge, setNewKidAge] = useState('');
  const [addingKid, setAddingKid] = useState(false);
  const navigate = useNavigate();
  // Live via onSnapshot. The landing page shows the two sections the owner
  // asked for (issue #338) — the pending requests and the confirmed
  // appointments; past and declined history stays on /family/appointments.
  const { pending, confirmed, loading: aptsLoading } = useFamilyAppointments();

  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  // Run-scoped: mount + familyId change + focus refetch can overlap.
  const loadRunRef = useRef(0);

  const loadFamily = useCallback(async () => {
    if (!familyId) return;
    const runId = ++loadRunRef.current;
    try {
      const familySnap = await getDoc(doc(db, 'families', familyId));
      if (runId !== loadRunRef.current) return;
      if (familySnap.exists()) {
        setFamilyName(familySnap.data().familyName || '');
      }
      const kidsSnap = await getDocs(collection(db, 'families', familyId, 'kids'));
      if (runId !== loadRunRef.current) return;
      setKids(kidsSnap.docs.map((d) => ({ kidId: d.id, firstName: d.data().firstName, age: d.data().age })));
      setKidsLoaded(true);
    } catch {
      // Focus refetch may fire on a network blip — keep last-known-good name
      // and kids rather than rejecting out of the hook's void call.
    }
  }, [familyId]);

  useEffect(() => {
    loadFamily();
  }, [loadFamily]);

  useEffect(() => {
    if (getParentProfile(userDoc)) {
      fetchVerificationStatus();
    }
  }, []);

  // Issue #117 tier (a): appointments are already live via onSnapshot; re-run
  // the remaining fetch-on-mount reads (family doc + kids, verification
  // status) when the user returns to the tab.
  useRefetchOnFocus(() => {
    loadFamily();
    if (getParentProfile(userDoc)) {
      fetchVerificationStatus();
    }
  });

  // ── Family-less parent (issue #293): after removeCoParent the removed
  // co-parent keeps their parent profile (so the guard still routes them
  // here) but has no family membership — every load above no-ops and the
  // normal dashboard renders empty with no explanation. Say what the state
  // is and point at both recovery paths: a fresh invite link (JoinFamilyPage
  // is the only client path into the server's re-attach carve-out, #284) or
  // enrolling a new family. Membership, not profile presence: a legacy
  // Plan C doc (root familyId) is an active member and must never see this. ──
  if (!hasFamilyMembership(userDoc)) {
    return (
      <div className="px-5 pt-4 pb-8">
        <DashboardGreeting firstName={userDoc?.firstName} />
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="mb-2 text-base font-bold text-amber-900">
            {t('familyDashboard.noFamilyTitle')}
          </h2>
          <p className="mb-2 text-sm text-amber-800">{t('familyDashboard.noFamilyDesc')}</p>
          <p className="mb-4 text-sm text-amber-800">{t('familyDashboard.noFamilyInviteHint')}</p>
          <Link to="/enroll/parent">
            <Button size="sm">{t('familyDashboard.noFamilyEnrollCta')}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  // ── The two sections (issue #338). This SUPERSEDES the single summary card
  // of issue #241 for the landing page only: the dedicated
  // /family/appointments page (reached from the hamburger menu) still owns
  // every action and the past/declined history, so nothing moved back here
  // except the two live lists the owner asked to see. ──
  // Date floor, matching the study page's rule (PR #345 review): nothing
  // server-side ever expires a pending appointment -- cleanupOldData
  // documents pending retention as deliberately unbounded -- and
  // useFamilyAppointments gives `pending` no date treatment at all (only
  // CONFIRMED docs get bucketed into pastRecent once they end). Sorted
  // soonest-first, a request for a date that has passed would pin itself to
  // the very first row, forever, with nothing either side can do about it
  // from here. A recurring request has no date and always stays.
  const today = parisNowStamp().slice(0, 10);
  const requestRows = pending.filter((a) => !a.date || a.date >= today).sort(bySoonest);
  // The badge is a TO-DO count. A request the FAMILY sent is waiting on the
  // babysitter; only one a babysitter opened by answering our published search
  // asks something of us (issue #207 PR3), so only those count.
  const requestsTodo = requestRows.filter((a) => a.initiatedBy === 'babysitter').length;
  // No floor needed here: the hook already moves a confirmed appointment into
  // pastRecent once date+endTime is behind us.
  const appointmentRows = [...confirmed].sort(bySoonest);
  const hasAny = requestRows.length > 0 || appointmentRows.length > 0;

  /** The row's date/time line: a concrete date+time, or the weekly slots of a
   * recurring appointment (whose occurrences have no single date). */
  const whenLine = (apt: AppointmentDoc): string => {
    if (apt.date) {
      const day = new Date(apt.date + 'T00:00:00').toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const time =
        apt.startTime && apt.endTime
          ? `${apt.startTime}–${apt.endTime}`
          : apt.startTime || null;
      return [day, time].filter(Boolean).join(' · ');
    }
    if (apt.recurringSlots?.length) {
      return apt.recurringSlots
        .map((sl: RecurringSlot) => `${t(`days.${sl.day}`)} ${sl.startTime}–${sl.endTime}`)
        .join(', ');
    }
    return t('request.recurring');
  };

  /** One section row. Navigates to /family/appointments, where the cancel /
   * edit / accept-decline actions live — the same rule both provider
   * dashboards follow (a landing page fires no callable). */
  const row = (apt: AppointmentDoc, variant: 'pending' | 'confirmed') => (
    <Link key={apt.appointmentId} to="/family/appointments" className="block">
      <Card interactive>
        <div className="flex items-center gap-3">
          <CalendarIcon className="h-5 w-5 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">{whenLine(apt)}</p>
              <Badge variant={variant === 'pending' ? 'amber' : 'green'}>
                {variant === 'pending'
                  ? t('familyDashboard.badgePending')
                  : t('familyDashboard.badgeConfirmed')}
              </Badge>
            </div>
            {variant === 'pending' && (
              <p className="mt-1 text-xs text-amber-700">
                {apt.initiatedBy === 'babysitter'
                  ? t('familyDashboard.answeredPublishedSearch')
                  : t('familyDashboard.awaitingBabysitter')}
              </p>
            )}
          </div>
          <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-500" />
        </div>
      </Card>
    </Link>
  );

  return (
    <div className="px-5 pt-4 pb-8">
      {/* Header — the shared idiom (parity D1, issue #239) */}
      <DashboardGreeting
        firstName={userDoc?.firstName}
        contextLine={`${formatFamilyTitle(familyName)} ${t('familyDashboard.family')}`}
      />

      {/* One-time cross-app welcome (issue #144) */}
      <CrossAppWelcomeCard />

      {/* Install-as-PWA banner (only when running in a regular browser tab) */}
      <InstallAppBanner />

      {/* Verification banner */}
      {familyVerification && !familyVerification.isFullyVerified && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-center">
            <p className="mb-2 text-sm font-semibold text-amber-800">{t('verification.required')}</p>
            <p className="mb-3 text-xs text-amber-600">{t('verification.requiredDesc')}</p>
            <Link to="/family/verification">
              <Button size="sm">{t('verification.completeVerification')}</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Kids management — shown prominently when no kids exist */}
      {kidsLoaded && kids.length === 0 && (
        <Card className="mb-4 border-brand-200 bg-brand-50">
          <h3 className="mb-2 text-sm font-semibold text-brand-800">{t('familyDashboard.addKidsTitle')}</h3>
          <p className="mb-4 text-xs text-brand-600">{t('familyDashboard.addKidsDesc')}</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder={t('enrollment.kidName')}
                value={newKidName}
                onChange={(e) => setNewKidName(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Input
                type="number"
                placeholder={t('enrollment.kidAge')}
                value={newKidAge}
                onChange={(e) => setNewKidAge(e.target.value)}
                min={0}
                max={18}
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={addingKid || !newKidName.trim() || !newKidAge}
            onClick={async () => {
              if (!familyId) return;
              setAddingKid(true);
              try {
                await addDoc(collection(db, 'families', familyId, 'kids'), {
                  firstName: newKidName.trim(),
                  age: parseInt(newKidAge) || 0,
                  languages: [],
                });
                setKids([...kids, { kidId: '', firstName: newKidName.trim(), age: parseInt(newKidAge) || 0 }]);
                setNewKidName('');
                setNewKidAge('');
              } finally {
                setAddingKid(false);
              }
            }}
          >
            <PlusIcon className="h-4 w-4" />
            {addingKid ? '...' : t('enrollment.addChild')}
          </Button>
        </Card>
      )}

      {/* Find a Babysitter — only when verified AND has kids */}
      {(!familyVerification || familyVerification.isFullyVerified) && kidsLoaded && kids.length > 0 && (
        <Button className="mb-6 h-14 text-lg" onClick={() => navigate('/family/search')}>
          <SearchIcon className="h-5 w-5" />
          {t('search.findBabysitter')}
        </Button>
      )}

      {/* ── Requests & appointments, in the babysitter dashboard's section
          idiom (issue #338). Skeletons sized like the loaded rows, so the
          list keeps its footprint while loading (UX F12, issue #126). ── */}
      {aptsLoading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : hasAny ? (
        <>
          <DashboardSection
            title={t('familyDashboard.yourRequests')}
            count={requestsTodo}
            total={requestRows.length}
            variant="pending"
          >
            {requestRows.map((apt) => row(apt, 'pending'))}
          </DashboardSection>
          <DashboardSection
            title={t('familyDashboard.yourAppointments')}
            count={appointmentRows.length}
            variant="confirmed"
          >
            {appointmentRows.map((apt) => row(apt, 'confirmed'))}
          </DashboardSection>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">📅</div>
          <h3 className="mb-2 text-lg font-semibold">{t('familyDashboard.noAppointments')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('familyDashboard.noAppointmentsDesc')}
          </p>
        </div>
      )}
    </div>
  );
}
