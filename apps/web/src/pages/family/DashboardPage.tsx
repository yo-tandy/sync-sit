import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Button, Badge, Card, Spinner, Input, Dialog, Textarea } from '@/components/ui';
import { CalendarIcon, ChevronRightIcon, PlusIcon, SearchIcon } from '@/components/ui/Icons';
import { Avatar } from '@/components/ui';
import type { AppointmentDoc, BabysitterUser } from '@ejm/shared';
import { formatBabysitterName, capitalize, formatFamilyTitle } from '@/lib/formatName';
import { useHolidays } from '@/hooks/useHolidays';
import { getDateTag } from '@/lib/dateTag';
import { DateTag } from '@/components/ui/DateTag';

interface BabysitterInfo {
  name: string;
  age?: number;
  classLevel?: string;
  languages?: string[];
  photoUrl?: string;
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
}

const borderColors: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#22c55e',
  past: '#9ca3af',
  rejected: '#9ca3af',
};

const badgeVariants: Record<string, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  confirmed: 'green',
  past: 'gray',
  rejected: 'gray',
};

function useBadgeLabels() {
  const { t } = useTranslation();
  return {
    pending: t('familyDashboard.badgePending'),
    confirmed: t('familyDashboard.badgeConfirmed'),
    past: t('familyDashboard.badgeCompleted'),
    rejected: t('familyDashboard.badgeDeclined'),
  } as Record<string, string>;
}

function ExpandableBabysitterCard({
  appointment,
  info,
  variant,
  isReturning,
  onCancel,
  onEdit,
}: {
  appointment: AppointmentDoc;
  info?: BabysitterInfo;
  variant: string;
  isReturning?: boolean;
  onCancel?: () => void;
  onEdit?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const [expanded, setExpanded] = useState(false);
  const badgeLabels = useBadgeLabels();
  const { periods: holidayPeriods } = useHolidays();
  const name = info?.name || t('familyDashboard.babysitterFallback');

  // Format date/time for confirmed/past cards
  const dateTimeStr = appointment.date
    ? new Date(appointment.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
      + (appointment.startTime && appointment.endTime ? ` · ${appointment.startTime}–${appointment.endTime}` : '')
    : null;

  return (
    <Card borderColor={borderColors[variant]} className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <Avatar initials={name.split(' ').map((w: string) => w[0] || '').join('').slice(0, 2)} src={info?.photoUrl || undefined} size="sm" />
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-900">{name}</p>
              {isReturning && <span className="text-blue-500" title="Returning">⭐</span>}
            </div>
            {/* Pending: show age + class */}
            {variant === 'pending' && info?.age && (
              <span className="text-xs text-gray-500">
                {info.age} {t('familyDashboard.ageSuffix')}{info.classLevel ? ` · ${info.classLevel}` : ''}
              </span>
            )}
            {/* Confirmed/past/rejected: show date + time */}
            {variant !== 'pending' && dateTimeStr && (
              <span className="text-xs text-gray-500">{dateTimeStr}</span>
            )}
            <DateTag tag={getDateTag(appointment.date || '', appointment.startTime || '', holidayPeriods)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariants[variant]}>{badgeLabels[variant]}</Badge>
          {(appointment as any).modified && (
            <Badge variant="amber" className="ml-1">{t('appointment.modified')}</Badge>
          )}
          <ChevronRightIcon className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && info && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          {info.classLevel && (
            <p className="text-xs text-gray-600">{t('familyDashboard.classLabel')} {info.classLevel}</p>
          )}
          {info.languages && info.languages.length > 0 && (
            <p className="text-xs text-gray-600">🗣 {info.languages.join(', ')}</p>
          )}
          {info.kidAgeRange && (
            <p className="text-xs text-gray-600">👶 {t('familyDashboard.agesRange', { min: info.kidAgeRange.min, max: info.kidAgeRange.max })}{info.maxKids ? t('familyDashboard.upToKids', { count: info.maxKids }) : ''}</p>
          )}
          {info.aboutMe && (
            <p className="text-xs text-gray-600 italic">"{info.aboutMe}"</p>
          )}
          {appointment.offeredRate && (
            <p className="text-xs text-gray-600">💰 {t('familyDashboard.rateOffered', { rate: appointment.offeredRate })}</p>
          )}
          {appointment.message && (
            <p className="text-xs text-gray-600">💬 {appointment.message}</p>
          )}

          {/* Contact details */}
          {(info.contactEmail || info.contactPhone) && (
            <div className="mt-2 rounded-lg bg-gray-50 p-2.5">
              <p className="mb-1 text-xs font-medium text-gray-500">{t('familyDashboard.contactLabel')}</p>
              {info.contactEmail && (
                <p className="text-xs text-gray-700">
                  📧 <a href={`mailto:${info.contactEmail}`} className="text-red-600 hover:underline">{info.contactEmail}</a>
                </p>
              )}
              {info.contactPhone && (
                <p className="text-xs text-gray-700">
                  📞 <a href={`tel:${info.contactPhone}`} className="text-red-600 hover:underline">{info.contactPhone}</a>
                </p>
              )}
            </div>
          )}

          {/* Date/time for non-grouped sections */}
          {variant !== 'pending' && appointment.date && (
            <p className="text-xs text-gray-500">
              📅 {new Date(appointment.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
              {appointment.startTime && appointment.endTime && ` · ${appointment.startTime}–${appointment.endTime}`}
            </p>
          )}

          {(variant === 'pending' || variant === 'confirmed') && onEdit && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                {t('appointment.edit')}
              </Button>
            </div>
          )}
          {variant === 'confirmed' && onCancel && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="w-full">
                {t('appointment.cancel')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function groupByDateTime(
  appointments: AppointmentDoc[],
  locale: string,
  dayNames: Record<string, string>,
  recurringLabel: string,
): { label: string; appointments: AppointmentDoc[] }[] {
  const groups = new Map<string, AppointmentDoc[]>();
  for (const apt of appointments) {
    let key: string;
    if (apt.date) {
      const dateStr = new Date(apt.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
      key = apt.startTime && apt.endTime ? `${dateStr} · ${apt.startTime}–${apt.endTime}` : dateStr;
    } else {
      if (apt.recurringSlots && apt.recurringSlots.length > 0) {
        key = apt.recurringSlots.map((s: any) => `${dayNames[s.day] || s.day} ${s.startTime}–${s.endTime}`).join(', ');
      } else {
        key = recurringLabel;
      }
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(apt);
  }
  return [...groups.entries()].map(([label, appointments]) => ({ label, appointments }));
}

export function FamilyDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const dayNamesForGroup: Record<string, string> = {
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  };
  const { userDoc } = useAuthStore();
  const { familyVerification, fetchStatus: fetchVerificationStatus } = useVerificationStore();
  const [familyName, setFamilyName] = useState('');
  const [kids, setKids] = useState<{ kidId: string; firstName: string; age: number }[]>([]);
  const [kidsLoaded, setKidsLoaded] = useState(false);
  const [newKidName, setNewKidName] = useState('');
  const [newKidAge, setNewKidAge] = useState('');
  const [addingKid, setAddingKid] = useState(false);
  const navigate = useNavigate();
  const { pending, confirmed, pastRecent, rejectedRecent, loading: aptsLoading } = useFamilyAppointments();

  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [editTarget, setEditTarget] = useState<any>(null);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editAdditionalInfo, setEditAdditionalInfo] = useState('');
  const [editing, setEditing] = useState(false);

  const handleCancel = async () => {
    if (!cancelTarget || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      const fn = httpsCallable(functions, 'cancelAppointment');
      await fn({ appointmentId: cancelTarget, reason: cancelReason.trim() });
      setCancelTarget(null);
      setCancelReason('');
      // Refresh will happen via Firestore listener
    } catch (err: any) {
      alert(err.message || 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  };

  const openEdit = (apt: any) => {
    setEditTarget(apt);
    setEditStartTime(apt.startTime || '');
    setEditEndTime(apt.endTime || '');
    setEditMessage(apt.message || '');
    setEditAdditionalInfo(apt.additionalInfo || '');
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setEditing(true);
    try {
      const fn = httpsCallable(functions, 'modifyAppointment');
      await fn({
        appointmentId: editTarget.appointmentId,
        startTime: editStartTime,
        endTime: editEndTime,
        message: editMessage,
        additionalInfo: editAdditionalInfo,
      });
      setEditTarget(null);
    } catch (err: any) {
      alert(err.message || 'Failed to modify');
    } finally {
      setEditing(false);
    }
  };

  const [babysitters, setBabysitters] = useState<Record<string, BabysitterInfo>>({});

  // Babysitters who have had a confirmed appointment with this family
  const returningBabysitterIds = new Set(
    [...confirmed, ...pastRecent].map((a) => a.babysitterUserId).filter(Boolean)
  );

  // Look up babysitter profiles for all appointments
  useEffect(() => {
    const allApts = [...pending, ...confirmed, ...pastRecent, ...rejectedRecent];
    const uids = [...new Set(allApts.map((a) => a.babysitterUserId).filter(Boolean))];
    const missing = uids.filter((uid) => !babysitters[uid]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const u = snap.data() as BabysitterUser;
            const dob = typeof u.dateOfBirth === 'string' ? new Date(u.dateOfBirth) : u.dateOfBirth?.toDate?.() ? u.dateOfBirth.toDate() : null;
            let age: number | undefined;
            if (dob) {
              age = new Date().getFullYear() - dob.getFullYear();
              const m = new Date().getMonth() - dob.getMonth();
              if (m < 0 || (m === 0 && new Date().getDate() < dob.getDate())) age--;
            }
            const info: BabysitterInfo = {
              name: formatBabysitterName(u.firstName, u.lastName),
              age,
              classLevel: u.classLevel,
              languages: u.languages,
              photoUrl: u.photoUrl,
              aboutMe: u.aboutMe,
              contactEmail: u.contactEmail,
              contactPhone: u.contactPhone,
              kidAgeRange: u.kidAgeRange,
              maxKids: u.maxKids,
            };
            return [uid, info] as [string, BabysitterInfo];
          }
        } catch { /* permission error */ }
        return [uid, { name: t('familyDashboard.babysitterFallback') }] as [string, BabysitterInfo];
      })
    ).then((entries) => {
      const newData = Object.fromEntries(entries);
      setBabysitters((prev) => ({ ...prev, ...newData }));
    });
  }, [pending, confirmed, pastRecent, rejectedRecent]);

  useEffect(() => {
    async function loadFamily() {
      if (userDoc?.role === 'parent' && userDoc.familyId) {
        const familySnap = await getDoc(doc(db, 'families', userDoc.familyId));
        if (familySnap.exists()) {
          setFamilyName(familySnap.data().familyName || '');
        }
        const kidsSnap = await getDocs(collection(db, 'families', userDoc.familyId, 'kids'));
        setKids(kidsSnap.docs.map((d) => ({ kidId: d.id, firstName: d.data().firstName, age: d.data().age })));
        setKidsLoaded(true);
      }
    }
    loadFamily();
  }, [userDoc]);

  useEffect(() => {
    if (userDoc?.role === 'parent') {
      fetchVerificationStatus();
    }
  }, []);

  return (
    <div className="px-5 pt-4 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold">{t('babysitterDashboard.hello')} {capitalize(userDoc?.firstName) || 'there'} 👋</h2>
        <p className="text-xs text-gray-500">{formatFamilyTitle(familyName)} {t('familyDashboard.family')}</p>
      </div>

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
        <Card className="mb-4 border-red-200 bg-red-50">
          <h3 className="mb-2 text-sm font-semibold text-red-800">{t('familyDashboard.addKidsTitle')}</h3>
          <p className="mb-4 text-xs text-red-600">{t('familyDashboard.addKidsDesc')}</p>
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
              if (!(userDoc as any)?.familyId) return;
              setAddingKid(true);
              try {
                await addDoc(collection(db, 'families', (userDoc as any).familyId, 'kids'), {
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

      {/* Appointments */}
      {aptsLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      ) : pending.length > 0 || confirmed.length > 0 || pastRecent.length > 0 || rejectedRecent.length > 0 ? (
        <>
          {pending.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{t('familyDashboard.pendingRequests')}</h3>
                <Badge variant="amber">{pending.length}</Badge>
              </div>
              {groupByDateTime(pending, locale, dayNamesForGroup, t('request.recurring')).map(({ label, appointments }) => (
                <div key={label} className="mb-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </div>
                  {appointments.map((apt) => (
                    <ExpandableBabysitterCard
                      key={apt.appointmentId}
                      appointment={apt}
                      info={babysitters[apt.babysitterUserId]}
                      variant="pending"
                      isReturning={returningBabysitterIds.has(apt.babysitterUserId)}
                      onEdit={() => openEdit(apt)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {confirmed.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{t('babysitterDashboard.confirmed')}</h3>
                <Badge variant="green">{confirmed.length}</Badge>
              </div>
              {confirmed.map((apt) => (
                <ExpandableBabysitterCard
                  key={apt.appointmentId}
                  appointment={apt}
                  info={babysitters[apt.babysitterUserId]}
                  variant="confirmed"
                  isReturning={returningBabysitterIds.has(apt.babysitterUserId)}
                  onCancel={() => setCancelTarget(apt.appointmentId)}
                  onEdit={() => openEdit(apt)}
                />
              ))}
            </div>
          )}
          {pastRecent.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('babysitterDashboard.past')}</h3>
              {pastRecent.map((apt) => (
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="past" />
              ))}
            </div>
          )}
          {rejectedRecent.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('familyDashboard.declined')}</h3>
              {rejectedRecent.map((apt) => (
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="rejected" />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">👶</div>
          <h3 className="mb-2 text-lg font-semibold">{t('familyDashboard.noAppointments')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('familyDashboard.noAppointmentsDesc')}
          </p>
        </div>
      )}

      <Dialog open={!!cancelTarget} onClose={() => { setCancelTarget(null); setCancelReason(''); }}>
        <h3 className="mb-2 text-lg font-semibold">{t('appointment.cancelTitle')}</h3>
        <p className="mb-4 text-sm text-gray-500">{t('appointment.cancelDesc')}</p>
        <Textarea
          label={t('appointment.cancelReason')}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('appointment.cancelReasonPlaceholder')}
          required
        />
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setCancelTarget(null); setCancelReason(''); }}>
            {t('common.back')}
          </Button>
          <Button size="sm" onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}>
            {cancelling ? '...' : t('appointment.confirmCancel')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)}>
        <h3 className="mb-2 text-lg font-semibold">{t('appointment.editTitle')}</h3>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t('search.startTime')} type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
            </div>
            <div className="flex-1">
              <Input label={t('search.endTime')} type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
            </div>
          </div>
          <Textarea label={t('appointment.messageLabel')} value={editMessage} onChange={(e) => setEditMessage(e.target.value)} />
          <Textarea label={t('appointment.additionalInfoLabel')} value={editAdditionalInfo} onChange={(e) => setEditAdditionalInfo(e.target.value)} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={handleEdit} disabled={editing}>{editing ? '...' : t('appointment.saveChanges')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
