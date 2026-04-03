import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { haversineDistance } from '@ejm/shared';
import { Button, Card, Badge, Dialog, TopNav, Spinner } from '@/components/ui';
import { PhotoLightbox } from '@/components/ui/PhotoLightbox';
import { CalendarIcon, CheckIcon } from '@/components/ui/Icons';
import { useHolidays } from '@/hooks/useHolidays';
import { getDateTag } from '@/lib/dateTag';
import { DateTag } from '@/components/ui/DateTag';
import type { BabysitterUser } from '@ejm/shared';
import { buildCalendarUrl } from '@/lib/calendar';

export function RequestDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const { periods: holidayPeriods } = useHolidays();
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { userDoc } = useAuthStore();
  const babysitter = userDoc as BabysitterUser | null;

  const [appointment, setAppointment] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptDialog, setAcceptDialog] = useState(false);
  const [declineDialog, setDeclineDialog] = useState(false);
  const [blockSchedule, setBlockSchedule] = useState(true);
  const [responding, setResponding] = useState(false);
  const [success, setSuccess] = useState<'accepted' | 'declined' | null>(null);
  const [isReturningFamily, setIsReturningFamily] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [parentContacts, setParentContacts] = useState<{ firstName: string; lastName: string; email: string; phone?: string; whatsapp?: string }[]>([]);

  useEffect(() => {
    if (!appointmentId) return;
    const unsub = onSnapshot(doc(db, 'appointments', appointmentId), (snap) => {
      if (snap.exists()) {
        setAppointment(snap.data());
      }
      setLoading(false);
    });
    return unsub;
  }, [appointmentId]);

  // Load parent contacts via cloud function (bypasses Firestore rules)
  useEffect(() => {
    if (!appointmentId || !appointment) return;
    async function loadParents() {
      try {
        const fn = httpsCallable(functions, 'getParentContacts');
        const result = await fn({ appointmentId });
        setParentContacts((result.data as any).contacts || []);
      } catch { /* function unavailable */ }
    }
    loadParents();
  }, [appointmentId, appointment?.familyId]);

  // Check if this is a returning family
  useEffect(() => {
    if (!appointment?.familyId || !babysitter?.uid) return;
    async function checkReturning() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'appointments'),
            where('babysitterUserId', '==', babysitter!.uid),
            where('familyId', '==', appointment.familyId),
            where('status', '==', 'confirmed')
          )
        );
        setIsReturningFamily(snap.size > 0);
      } catch { /* ignore */ }
    }
    checkReturning();
  }, [appointment?.familyId, babysitter?.uid]);

  const handleAcknowledge = async () => {
    setAcknowledging(true);
    try {
      const fn = httpsCallable(functions, 'acknowledgeModification');
      await fn({ appointmentId });
    } catch (err: any) {
      alert(err.message || 'Failed');
    } finally {
      setAcknowledging(false);
    }
  };

  const handleRespond = async (action: 'accept' | 'decline') => {
    if (!appointmentId) return;
    setResponding(true);
    try {
      const respondFn = httpsCallable(functions, 'respondToRequest');
      await respondFn({
        appointmentId,
        action,
        blockSchedule: action === 'accept' ? blockSchedule : false,
      });
      setSuccess(action === 'accept' ? 'accepted' : 'declined');
      setAcceptDialog(false);
      setDeclineDialog(false);
    } catch (err: any) {
      alert(err.message || 'Something went wrong. Please try again.');
    } finally {
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div>
        <TopNav title={t('request.title')} backTo="/babysitter" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div>
        <TopNav title={t('request.title')} backTo="/babysitter" />
        <div className="px-5 pt-8 text-center">
          <p className="text-gray-500">{t('request.notFound')}</p>
        </div>
      </div>
    );
  }

  const apt = appointment;
  const isPending = apt.status === 'pending';
  const rawFamilyName = apt.familyName || 'Family';
  const familyName = t('familyDashboard.familyTitle', { name: rawFamilyName.toUpperCase() });
  const kids: { age: number; languages?: string[] }[] = apt.kids || [];
  // parentContacts loaded dynamically from family doc (useEffect above)

  // Distance
  let distance: string | null = null;
  if (babysitter?.areaLatLng && apt.latLng) {
    const km = haversineDistance(babysitter.areaLatLng, apt.latLng);
    distance = t('request.kmFromYou', { distance: Math.round(km * 10) / 10 });
  }

  return (
    <div>
      <TopNav title={t('request.title')} backTo="/babysitter" />

      <div className="px-5 pt-4 pb-8">
        {/* Family header */}
        <div className="mb-4 flex items-center gap-3">
          <PhotoLightbox
            src={apt.familyPhotoUrl || undefined}
            initials={familyName.split(' ').map((w: string) => w[0] || '').join('').slice(0, 2)}
            size="lg"
          />
          <div className="flex-1">
            <h2 className="text-xl font-bold">
              {familyName}
              {isReturningFamily && <span className="ml-1.5 text-blue-500" title="Returning family">⭐</span>}
            </h2>
            <Badge
              variant={apt.status === 'pending' ? 'amber' : apt.status === 'confirmed' ? 'green' : 'gray'}
            >
              {apt.status === 'pending' ? t('request.pending') : apt.status === 'confirmed' ? t('request.confirmed') : t('request.declined')}
            </Badge>
          </div>
        </div>

        {apt.modified && (
          <Card className="mb-4 border-amber-300 bg-amber-50">
            <p className="mb-1 text-sm font-semibold text-amber-800">{t('appointment.modifiedBanner')}</p>
            {apt.modifiedFields?.length > 0 && (
              <p className="mb-3 text-xs text-amber-600">{t('appointment.modifiedFieldsLabel')}: {apt.modifiedFields.join(', ')}</p>
            )}
            <Button size="sm" onClick={handleAcknowledge} disabled={acknowledging}>
              {acknowledging ? '...' : t('appointment.acknowledgeChanges')}
            </Button>
          </Card>
        )}

        {apt.isResubmission && (
          <Card className="mb-4 border-blue-300 bg-blue-50">
            <p className="text-sm font-semibold text-blue-800">{t('appointment.resubmittedBanner')}</p>
          </Card>
        )}

        {/* Date / time */}
        <Card className="mb-3">
          <div className="flex items-center gap-2 text-sm">
            <CalendarIcon className="h-4 w-4 text-gray-400" />
            {apt.date ? (
              <span>
                {new Date(apt.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
                {apt.startTime && apt.endTime && `, ${apt.startTime}–${apt.endTime}`}
              </span>
            ) : (
              <span>
                {apt.recurringSlots?.length > 0
                  ? apt.recurringSlots.map((s: any) => {
                      const dayNames: Record<string, string> = { mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'), fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays') };
                      return `${dayNames[s.day] || s.day} ${s.startTime}–${s.endTime}`;
                    }).join(', ')
                  : t('request.recurring')}
              </span>
            )}
          </div>
          <DateTag tag={getDateTag(apt.date || '', apt.startTime || '', holidayPeriods)} className="mt-1" />
          {apt.status === 'confirmed' && apt.date && apt.startTime && apt.endTime && (
            <a
              href={buildCalendarUrl(apt.date, apt.startTime, apt.endTime, familyName, apt.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 active:text-red-800"
            >
              <span>📅</span> {t('request.addToCalendar')}
            </a>
          )}
        </Card>

        {/* Children (ages only) */}
        {kids.length > 0 && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500 mb-1">{t('request.children')}</p>
            <p className="text-sm">
              👶 {kids.length} {kids.length === 1 ? t('request.child') : t('request.childPlural')} — ages {kids.map((k) => k.age).join(', ')}
            </p>
            {kids.some((k) => k.languages && k.languages.length > 0) && (
              <p className="mt-1 text-xs text-gray-500">
                🗣 {[...new Set(kids.flatMap((k) => k.languages || []))].join(', ')}
              </p>
            )}
          </Card>
        )}

        {/* Address + distance */}
        {apt.address && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.address')}</p>
            <p className="text-sm">{apt.address}</p>
            {distance && <p className="mt-1 text-xs text-gray-500">📍 {distance}</p>}
          </Card>
        )}

        {/* Pets */}
        {apt.pets && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.petsLabel')}</p>
            <p className="text-sm">🐾 {apt.pets}</p>
          </Card>
        )}

        {/* Family note */}
        {apt.familyNote && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.familyNote')}</p>
            <p className="text-sm">{apt.familyNote}</p>
          </Card>
        )}

        {/* Rate */}
        {apt.offeredRate && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.rateOffered')}</p>
            <p className="text-sm font-semibold">€{apt.offeredRate}/hr</p>
          </Card>
        )}

        {/* Message from parent */}
        {apt.message && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.messageLabel')}</p>
            <p className="text-sm">{apt.message}</p>
          </Card>
        )}

        {/* Additional info */}
        {apt.additionalInfo && (
          <Card className="mb-3">
            <p className="text-xs font-medium text-gray-500">{t('request.additionalInfo')}</p>
            <p className="text-sm">{apt.additionalInfo}</p>
          </Card>
        )}

        {/* Parent contact details */}
        {parentContacts.length > 0 && (
          <Card className="mb-3 bg-gray-50">
            <p className="text-xs font-medium text-gray-500 mb-2">{t('request.contactLabel')}</p>
            {parentContacts.map((p, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <p className="mb-1 text-sm font-medium text-gray-900">{p.firstName} {p.lastName}</p>
                <a href={`mailto:${p.email}`} className="flex items-center gap-2 py-1.5 text-xs text-red-600 active:bg-gray-100">
                  <span>📧</span> <span>{p.email}</span>
                </a>
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="flex items-center gap-2 py-1.5 text-xs text-red-600 active:bg-gray-100">
                    <span>📞</span> <span>{p.phone}</span>
                  </a>
                )}
                {p.whatsapp && (
                  <a href={`https://wa.me/${p.whatsapp.replace(/[^\d+]/g, '').replace('+', '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1.5 text-xs text-green-600 active:bg-gray-100">
                    <span>💬</span> <span>WhatsApp</span>
                  </a>
                )}
              </div>
            ))}
          </Card>
        )}

        {/* Action buttons */}
        {isPending && (
          <div className="mt-6 flex gap-3">
            <Button onClick={() => setAcceptDialog(true)} className="flex-1">
              {t('request.accept')}
            </Button>
            <Button variant="outline" onClick={() => setDeclineDialog(true)} className="flex-1">
              {t('request.decline')}
            </Button>
          </div>
        )}
      </div>

      {/* Accept Dialog */}
      <Dialog open={acceptDialog} onClose={() => setAcceptDialog(false)}>
        <h3 className="mb-2 text-lg font-bold">{t('request.confirmAppointment')}</h3>
        <p className="mb-4 text-sm text-gray-600">
          {t('request.confirmDesc')}
        </p>
        {apt.date && (
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={blockSchedule}
                onChange={(e) => setBlockSchedule(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-red-600"
              />
              {t('request.blockSchedule')}
            </label>
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => handleRespond('accept')} disabled={responding} className="flex-1">
            {responding ? t('request.confirming') : t('request.confirmAccept')}
          </Button>
          <Button variant="ghost" onClick={() => setAcceptDialog(false)} className="flex-1">
            {t('request.goBack')}
          </Button>
        </div>
      </Dialog>

      {/* Decline Dialog */}
      <Dialog open={declineDialog} onClose={() => setDeclineDialog(false)}>
        <h3 className="mb-2 text-lg font-bold">{t('request.declineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">
          {t('request.declineDesc')}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => handleRespond('decline')} disabled={responding} className="flex-1">
            {responding ? t('request.declining') : t('request.confirmDecline')}
          </Button>
          <Button variant="ghost" onClick={() => setDeclineDialog(false)} className="flex-1">
            {t('request.goBack')}
          </Button>
        </div>
      </Dialog>

      {/* Success Dialog */}
      {success && (
        <Dialog open onClose={() => navigate('/babysitter')}>
          <div className="text-center">
            <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${success === 'accepted' ? 'bg-green-50' : 'bg-gray-100'}`}>
              {success === 'accepted' ? (
                <CheckIcon className="h-7 w-7 text-green-600" />
              ) : (
                <span className="text-2xl">👋</span>
              )}
            </div>
            <h3 className="mb-2 text-lg font-bold">
              {success === 'accepted' ? t('request.appointmentConfirmed') : t('request.requestDeclined')}
            </h3>
            <p className="mb-5 text-sm text-gray-600">
              {success === 'accepted'
                ? t('request.confirmedDesc')
                : t('request.declinedDesc')}
            </p>
            {success === 'accepted' && apt.date && apt.startTime && apt.endTime && (
              <a
                href={buildCalendarUrl(apt.date, apt.startTime, apt.endTime, familyName, apt.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 active:text-red-800"
              >
                <span>📅</span> {t('request.addToCalendar')}
              </a>
            )}
            <Button onClick={() => navigate('/babysitter')}>{t('request.backToDashboard')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
