import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, addDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Button, Badge, Card, Spinner, Input, Dialog, Textarea, InstallAppBanner } from '@/components/ui';
import { CalendarIcon, PlusIcon, SearchIcon } from '@/components/ui/Icons';
import type { AppointmentDoc, BabysitterUser } from '@ejm/shared';
import { formatBabysitterName, capitalize, formatFamilyTitle } from '@/lib/formatName';
import { debouncedTogglePreferred } from '@/lib/debouncedPreferred';
import { EndorsementDialog } from '@/components/endorsements/EndorsementDialog';
import { ExpandableBabysitterCard, type BabysitterCardInfo } from '@/components/appointments/ExpandableBabysitterCard';
import type { ReferenceDoc } from '@ejm/shared';


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

  const [resubmitTarget, setResubmitTarget] = useState<any>(null);
  const [resubmitStartTime, setResubmitStartTime] = useState('');
  const [resubmitEndTime, setResubmitEndTime] = useState('');
  const [resubmitRate, setResubmitRate] = useState('');
  const [resubmitNotes, setResubmitNotes] = useState('');
  const [resubmitting, setResubmitting] = useState(false);

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

  const openResubmit = (apt: any) => {
    setResubmitTarget(apt);
    setResubmitStartTime(apt.startTime || '');
    setResubmitEndTime(apt.endTime || '');
    setResubmitRate(apt.offeredRate ? String(apt.offeredRate) : '');
    setResubmitNotes('');
  };

  const handleResubmit = async () => {
    if (!resubmitTarget || !resubmitNotes.trim()) return;
    setResubmitting(true);
    try {
      const fn = httpsCallable(functions, 'resubmitAppointment');
      await fn({
        originalAppointmentId: resubmitTarget.appointmentId,
        startTime: resubmitStartTime,
        endTime: resubmitEndTime,
        offeredRate: resubmitRate ? parseFloat(resubmitRate) : undefined,
        additionalNotes: resubmitNotes.trim(),
      });
      setResubmitTarget(null);
    } catch (err: any) {
      alert(err.message || 'Failed to resubmit');
    } finally {
      setResubmitting(false);
    }
  };

  const [babysitters, setBabysitters] = useState<Record<string, BabysitterCardInfo>>({});
  const [preferredIds, setPreferredIds] = useState<Set<string>>(new Set());

  // References state
  const [submittedRefs, setSubmittedRefs] = useState<ReferenceDoc[]>([]);
  const [refTarget, setRefTarget] = useState<{ apt: any; existing?: ReferenceDoc } | null>(null);
  const [refPromptDismissed, setRefPromptDismissed] = useState(() => {
    const stored = localStorage.getItem('syncsit_ref_prompt_dismissed');
    return stored ? JSON.parse(stored) : false;
  });
  const dismissRefPrompt = () => {
    setRefPromptDismissed(true);
    localStorage.setItem('syncsit_ref_prompt_dismissed', 'true');
  };

  // Load submitted references for this user
  useEffect(() => {
    if (!userDoc?.uid) return;
    const unsub = onSnapshot(
      collection(db, 'references'),
      (snap) => {
        const refs = snap.docs
          .map((d) => ({ ...d.data(), referenceId: d.id }) as ReferenceDoc)
          .filter((r) => r.submittedByUserId === userDoc.uid && r.type === 'family_submitted' && r.status !== 'removed');
        setSubmittedRefs(refs);
      }
    );
    return unsub;
  }, [userDoc?.uid]);

  const getRefForAppointment = (appointmentId: string) =>
    submittedRefs.find((r) => r.appointmentId === appointmentId);

  // Find first past appointment without a reference (for auto-prompt)
  // Only show if the appointment was within the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const unreferencedPast = pastRecent.find((apt) => {
    if (getRefForAppointment(apt.appointmentId)) return false;
    if (!apt.date) return false;
    const aptDate = new Date(apt.date + 'T' + (apt.endTime || '23:59'));
    return aptDate >= sevenDaysAgo;
  });

  // Load preferred babysitter IDs from family doc
  const familyId = userDoc?.role === 'parent' ? (userDoc as any).familyId : null;
  useEffect(() => {
    if (!familyId) return;
    const unsub = onSnapshot(doc(db, 'families', familyId), (snap) => {
      setPreferredIds(new Set(snap.data()?.preferredBabysitters || []));
    });
    return unsub;
  }, [familyId]);

  const togglePreferred = (babysitterUserId: string) => {
    const isPref = preferredIds.has(babysitterUserId);
    // Optimistic UI update
    setPreferredIds((prev) => {
      const next = new Set(prev);
      if (isPref) next.delete(babysitterUserId);
      else next.add(babysitterUserId);
      return next;
    });
    // Debounced backend call (3s delay, cancels if toggled back)
    debouncedTogglePreferred(babysitterUserId, !isPref);
  };

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
            const info: BabysitterCardInfo = {
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
            return [uid, info] as [string, BabysitterCardInfo];
          }
        } catch { /* permission error */ }
        return [uid, { name: t('familyDashboard.babysitterFallback') }] as [string, BabysitterCardInfo];
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

      {/* Reference prompt banner */}
      {unreferencedPast && !refPromptDismissed && babysitters[unreferencedPast.babysitterUserId] && (
        <Card className="mb-4 border-blue-200 bg-blue-50 cursor-pointer" onClick={() => {
          setRefTarget({ apt: unreferencedPast });
          dismissRefPrompt();
        }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">✍️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-800">
                {t('references.referencePrompt', { name: babysitters[unreferencedPast.babysitterUserId]?.name || '' })}
              </p>
              <p className="text-xs text-blue-600">{t('references.referencePromptDesc', { name: babysitters[unreferencedPast.babysitterUserId]?.name?.split(' ')[0] || '' })}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismissRefPrompt(); }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-blue-400 hover:bg-blue-100 hover:text-blue-600"
            >
              ✕
            </button>
          </div>
        </Card>
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
                      isPreferred={preferredIds.has(apt.babysitterUserId)}
                      onTogglePreferred={() => togglePreferred(apt.babysitterUserId)}
                      onCancel={() => setCancelTarget(apt.appointmentId)}
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
                  isPreferred={preferredIds.has(apt.babysitterUserId)}
                  onTogglePreferred={() => togglePreferred(apt.babysitterUserId)}
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
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="past" isPreferred={preferredIds.has(apt.babysitterUserId)} onTogglePreferred={() => togglePreferred(apt.babysitterUserId)} existingReference={getRefForAppointment(apt.appointmentId)} onLeaveReference={() => setRefTarget({ apt, existing: getRefForAppointment(apt.appointmentId) })} />
              ))}
            </div>
          )}
          {rejectedRecent.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('familyDashboard.declined')}</h3>
              {rejectedRecent.map((apt) => (
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="rejected" isPreferred={preferredIds.has(apt.babysitterUserId)} onTogglePreferred={() => togglePreferred(apt.babysitterUserId)} onResubmit={() => openResubmit(apt)} />
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
        {(() => {
          const isCancellingPending = pending.some((a) => a.appointmentId === cancelTarget);
          return (
            <>
              <h3 className="mb-2 text-lg font-semibold">{isCancellingPending ? t('appointment.cancelRequestTitle') : t('appointment.cancelTitle')}</h3>
              <p className="mb-4 text-sm text-gray-500">{isCancellingPending ? t('appointment.cancelRequestDesc') : t('appointment.cancelDesc')}</p>
              <Textarea
                label={t('appointment.cancelReason')}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={isCancellingPending ? t('appointment.cancelRequestReasonPlaceholder') : t('appointment.cancelReasonPlaceholder')}
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
            </>
          );
        })()}
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

      <Dialog open={!!resubmitTarget} onClose={() => setResubmitTarget(null)}>
        <h3 className="mb-2 text-lg font-semibold">{t('appointment.resubmitTitle')}</h3>
        <p className="mb-4 text-sm text-gray-500">{t('appointment.resubmitDesc')}</p>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t('search.startTime')} type="time" value={resubmitStartTime} onChange={(e) => setResubmitStartTime(e.target.value)} />
            </div>
            <div className="flex-1">
              <Input label={t('search.endTime')} type="time" value={resubmitEndTime} onChange={(e) => setResubmitEndTime(e.target.value)} />
            </div>
          </div>
          <Input label={t('search.rateToPayLabel')} type="number" value={resubmitRate} onChange={(e) => setResubmitRate(e.target.value)} />
          <Textarea
            label={t('appointment.additionalNotes')}
            value={resubmitNotes}
            onChange={(e) => setResubmitNotes(e.target.value)}
            placeholder={t('appointment.additionalNotesPlaceholder')}
            required
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setResubmitTarget(null)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={handleResubmit} disabled={resubmitting || !resubmitNotes.trim()}>
            {resubmitting ? '...' : t('appointment.resubmit')}
          </Button>
        </div>
      </Dialog>

      {/* Reference Dialog */}
      {refTarget && (
        <EndorsementDialog
          babysitterUserId={refTarget.apt.babysitterUserId}
          babysitterName={babysitters[refTarget.apt.babysitterUserId]?.name || ''}
          appointmentId={refTarget.apt.appointmentId}
          existingReference={refTarget.existing}
          onClose={() => setRefTarget(null)}
        />
      )}
    </div>
  );
}
