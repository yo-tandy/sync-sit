import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Button, Badge, Card, Spinner, Input, InstallAppBanner } from '@/components/ui';
import { CalendarIcon, ChevronRightIcon, PlusIcon, SearchIcon } from '@/components/ui/Icons';
import type { AppointmentDoc } from '@ejm/sit-core';
import { getParentProfile } from '@ejm/sit-core';
import { hasFamilyMembership } from '@ejm/shared-core';
import { useRefetchOnFocus, DashboardGreeting } from '@ejm/shared-ui';
import { formatFamilyTitle } from '@/lib/formatName';
import { CrossAppWelcomeCard } from '@/components/family/CrossAppWelcomeCard';

/** The next upcoming confirmed appointment (earliest date+startTime), or null.
 * Recurring appointments (no date) can't claim "next" — they have no single
 * upcoming instant. */
function nextUpcoming(confirmed: AppointmentDoc[]): AppointmentDoc | null {
  let next: AppointmentDoc | null = null;
  for (const apt of confirmed) {
    if (!apt.date) continue;
    const key = `${apt.date}T${apt.startTime || '00:00'}`;
    const nextKey = next ? `${next.date}T${next.startTime || '00:00'}` : null;
    if (!nextKey || key < nextKey) next = apt;
  }
  return next;
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
  // Summary counts only (issue #241): the full lists live on the dedicated
  // /family/appointments page — the dashboard mirrors study's tile → page
  // pattern (a summary card that links out) instead of duplicating the lists.
  const { pending, confirmed, pastRecent, rejectedRecent, loading: aptsLoading } = useFamilyAppointments();

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

  // ── Appointments summary (issue #241): counts + the next upcoming
  // confirmed appointment; the card links to /family/appointments. ──
  const next = nextUpcoming(confirmed);
  const hasAny = pending.length > 0 || confirmed.length > 0 || pastRecent.length > 0 || rejectedRecent.length > 0;
  const nextLine = next?.date
    ? [
        new Date(next.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
        next.startTime && next.endTime ? `${next.startTime}–${next.endTime}` : next.startTime || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

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

      {/* Appointments summary → dedicated page (issue #241, parity Q1 = b) */}
      {aptsLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : (
        <Link
          to="/family/appointments"
          aria-label={t('familyDashboard.viewAppointments')}
          className="block"
        >
          <Card interactive className="flex items-center gap-3 py-4">
            <CalendarIcon className="h-6 w-6 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-gray-900">{t('familyDashboard.appointmentsTitle')}</p>
                {pending.length > 0 && <Badge variant="amber">{pending.length}</Badge>}
                {confirmed.length > 0 && <Badge variant="green">{confirmed.length}</Badge>}
              </div>
              {hasAny ? (
                <p className="text-sm text-gray-600">
                  {[
                    t('familyDashboard.appointmentsPending', { count: pending.length }),
                    t('familyDashboard.appointmentsUpcoming', { count: confirmed.length }),
                  ].join(' · ')}
                </p>
              ) : (
                <p className="text-sm text-gray-500">{t('familyDashboard.noAppointments')}</p>
              )}
              {nextLine && (
                <p className="text-xs text-gray-500">
                  {t('familyDashboard.appointmentsNext', { when: nextLine })}
                </p>
              )}
            </div>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-500" />
          </Card>
        </Link>
      )}
    </div>
  );
}
