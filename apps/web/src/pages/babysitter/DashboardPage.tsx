import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useAppointments } from '@/hooks/useAppointments';
import { useSchedule } from '@/hooks/useSchedule';
import { AppointmentCard } from '@/components/appointments/AppointmentCard';
import { Card, Badge, Dialog, Button, Spinner } from '@/components/ui';
import {
  CalendarIcon,
  ChevronRightIcon,
} from '@/components/ui/Icons';
import type { AppointmentDoc, BabysitterUser } from '@ejm/shared';
import { DAYS_OF_WEEK } from '@ejm/shared';

// ── Appointment Section ──
function Section({
  title,
  count,
  defaultOpen = true,
  variant,
  items,
  onCardClick,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  variant: 'pending' | 'confirmed' | 'past' | 'rejected';
  items: AppointmentDoc[];
  onCardClick?: (apt: AppointmentDoc) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)} className="mb-2 flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <Badge variant={variant === 'pending' ? 'amber' : variant === 'confirmed' ? 'green' : 'gray'}>
            {count}
          </Badge>
        </div>
        <ChevronRightIcon className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && items.map((apt) => (
        <AppointmentCard
          key={apt.appointmentId}
          appointment={apt}
          variant={variant}
          onClick={onCardClick ? () => onCardClick(apt) : undefined}
        />
      ))}
    </div>
  );
}

// ── Onboarding ──
// Tracks which dialogs have been dismissed this browser session
const ONBOARDING_KEY = 'babysitter_onboarding';

function getOnboardingDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}
function dismissOnboarding(key: string) {
  const dismissed = getOnboardingDismissed();
  dismissed.add(key);
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify([...dismissed]));
}

// ── Main Component ──
export function BabysitterDashboard() {
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const { pending, confirmed, pastRecent, rejectedRecent, loading } = useAppointments();
  const { weekly, loading: scheduleLoading } = useSchedule();
  const navigate = useNavigate();
  const babysitter = userDoc as BabysitterUser | null;
  const uid = firebaseUser?.uid;
  const { t } = useTranslation();

  const [toggleDialog, setToggleDialog] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Onboarding state
  const [showWelcome, setShowWelcome] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [showReferences, setShowReferences] = useState(false);

  const isSearchable = babysitter?.searchable ?? false;

  // Determine which onboarding dialog to show
  useEffect(() => {
    if (!babysitter || scheduleLoading) return;
    const dismissed = getOnboardingDismissed();
    const hasSlots = DAYS_OF_WEEK.some((d) => weekly[d]?.some(Boolean));

    // Step 1: Welcome — only on first session after enrollment
    // Detect "just enrolled" by checking if account was created less than 2 minutes ago
    const createdAt = babysitter.createdAt?.toDate?.();
    const isJustEnrolled = createdAt && (Date.now() - createdAt.getTime() < 2 * 60 * 1000);
    if (isJustEnrolled && !hasSlots && !dismissed.has('welcome')) {
      setShowWelcome(true);
      return;
    }

    // Step 2: Activate — after schedule has slots AND not yet searchable
    if (hasSlots && !isSearchable && !dismissed.has('activate')) {
      setShowActivate(true);
      return;
    }

    // Step 3: References — after just activated (searchable and not dismissed)
    if (isSearchable && !dismissed.has('references')) {
      setShowReferences(true);
      return;
    }
  }, [babysitter, scheduleLoading, weekly, isSearchable]);

  const handleToggleSearchable = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        searchable: !isSearchable,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();

      // If activating during onboarding, show references suggestion
      if (!isSearchable) {
        setToggleDialog(false);
        dismissOnboarding('activate');
        setTimeout(() => setShowReferences(true), 300);
        return;
      }
    } finally {
      setToggling(false);
      setToggleDialog(false);
    }
  };

  const hasAny = pending.length > 0 || confirmed.length > 0 || pastRecent.length > 0 || rejectedRecent.length > 0;

  return (
    <div className="px-5 pt-4 pb-8">
      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div>
            <p className="text-sm text-gray-500">{t('babysitterDashboard.hello')}</p>
            <h2 className="text-lg font-bold">{babysitter?.firstName || 'Babysitter'} 👋</h2>
          </div>
        </div>

        {/* Active/Inactive toggle */}
        <button
          onClick={() => setToggleDialog(true)}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            isSearchable
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          <div className={`h-2 w-2 rounded-full ${isSearchable ? 'bg-green-500' : 'bg-gray-400'}`} />
          {isSearchable ? t('babysitterDashboard.active') : t('babysitterDashboard.inactive')}
        </button>
      </div>

      {/* ── My Availability button ── */}
      <Link to="/babysitter/schedule" className="mb-6 block">
        <Card interactive className="flex items-center gap-3 py-4">
          <CalendarIcon className="h-6 w-6 text-red-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">{t('babysitterDashboard.myAvailability')}</p>
            <p className="text-xs text-gray-500">{t('babysitterDashboard.availabilityDesc')}</p>
          </div>
          <ChevronRightIcon className="h-5 w-5 text-gray-400" />
        </Card>
      </Link>

      {/* ── Appointments ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      ) : hasAny ? (
        <>
          <Section title={t('babysitterDashboard.newRequests')} count={pending.length} variant="pending" items={pending} onCardClick={(apt) => navigate(`/babysitter/request/${apt.appointmentId}`)} />
          <Section title={t('babysitterDashboard.confirmed')} count={confirmed.length} variant="confirmed" items={confirmed} onCardClick={(apt) => navigate(`/babysitter/request/${apt.appointmentId}`)} />
          <Section title={t('babysitterDashboard.past')} count={pastRecent.length} defaultOpen={false} variant="past" items={pastRecent} onCardClick={(apt) => navigate(`/babysitter/request/${apt.appointmentId}`)} />
          <Section title={t('babysitterDashboard.rejected')} count={rejectedRecent.length} defaultOpen={false} variant="rejected" items={rejectedRecent} onCardClick={(apt) => navigate(`/babysitter/request/${apt.appointmentId}`)} />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">📅</div>
          <h3 className="mb-2 text-lg font-semibold">{t('babysitterDashboard.noRequests')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('babysitterDashboard.noRequestsDesc')}
          </p>
        </div>
      )}

      {/* ── Toggle Confirmation Dialog ── */}
      <Dialog open={toggleDialog} onClose={() => setToggleDialog(false)}>
        <h3 className="mb-2 text-lg font-bold">
          {isSearchable ? t('babysitterDashboard.deactivateTitle') : t('babysitterDashboard.activateTitle')}
        </h3>
        <p className="mb-5 text-sm text-gray-600">
          {isSearchable
            ? t('babysitterDashboard.deactivateDesc')
            : t('babysitterDashboard.activateDesc')
          }
        </p>
        <div className="flex gap-2">
          <Button onClick={handleToggleSearchable} disabled={toggling} className="flex-1">
            {toggling ? t('babysitterDashboard.updating') : isSearchable ? t('babysitterDashboard.deactivate') : t('babysitterDashboard.activate')}
          </Button>
          <Button variant="ghost" onClick={() => setToggleDialog(false)} className="flex-1">
            Cancel
          </Button>
        </div>
      </Dialog>

      {/* ── Onboarding Dialogs ── */}
      {/* Step 1: Welcome — first session after enrollment only */}
      {showWelcome && (
        <Dialog open onClose={() => { setShowWelcome(false); dismissOnboarding('welcome'); }}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">📅</div>
            <h3 className="mb-2 text-lg font-bold">{t('onboarding.welcomeTitle')}</h3>
            <p className="mb-5 text-sm text-gray-600">
              {t('onboarding.welcomeDesc')}
            </p>
            <Button onClick={() => {
              setShowWelcome(false);
              dismissOnboarding('welcome');
              navigate('/babysitter/schedule');
            }}>
              {t('onboarding.setUpAvailability')}
            </Button>
            <button
              onClick={() => { setShowWelcome(false); dismissOnboarding('welcome'); }}
              className="mt-3 block w-full text-center text-sm text-gray-500"
            >
              {t('onboarding.illDoItLater')}
            </button>
          </div>
        </Dialog>
      )}

      {/* Step 2: Activate — after schedule set, only if not yet active */}
      {showActivate && (
        <Dialog open onClose={() => { setShowActivate(false); dismissOnboarding('activate'); }}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-2xl">✅</div>
            <h3 className="mb-2 text-lg font-bold">{t('onboarding.availabilitySetTitle')}</h3>
            <p className="mb-5 text-sm text-gray-600">
              {t('onboarding.availabilitySetDesc')}
            </p>
            <Button onClick={() => {
              setShowActivate(false);
              dismissOnboarding('activate');
              setToggleDialog(true);
            }}>
              {t('onboarding.activateNow')}
            </Button>
            <button
              onClick={() => { setShowActivate(false); dismissOnboarding('activate'); }}
              className="mt-3 block w-full text-center text-sm text-gray-500"
            >
              {t('onboarding.illDoItLater')}
            </button>
          </div>
        </Dialog>
      )}

      {/* Step 3: References — after activation */}
      {showReferences && (
        <Dialog open onClose={() => { setShowReferences(false); dismissOnboarding('references'); }}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-2xl">🌟</div>
            <h3 className="mb-2 text-lg font-bold">{t('onboarding.allSetTitle')}</h3>
            <p className="mb-5 text-sm text-gray-600">
              {t('onboarding.allSetDesc')}
            </p>
            <Button onClick={() => {
              setShowReferences(false);
              dismissOnboarding('references');
              navigate('/babysitter/references');
            }}>
              {t('onboarding.addReferences')}
            </Button>
            <button
              onClick={() => { setShowReferences(false); dismissOnboarding('references'); }}
              className="mt-3 block w-full text-center text-sm text-gray-500"
            >
              {t('onboarding.maybeLater')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
