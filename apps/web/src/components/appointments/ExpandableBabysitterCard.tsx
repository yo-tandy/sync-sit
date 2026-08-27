import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, query as fsQuery, where as fsWhere, limit as fsLimit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { Button, Badge, Card, Dialog } from '@/components/ui';
import { AppointmentNotes } from './AppointmentNotes';
import { AppointmentNoteDialog } from './AppointmentNoteDialog';
import { hasStarted } from '@/lib/appointmentTime';
import { ChevronRightIcon } from '@/components/ui/Icons';
import { Avatar } from '@/components/ui';
import type { AppointmentDoc, ReferenceDoc, BabysitterSummary } from '@ejm/sit-core';
import { useHolidays } from '@/hooks/useHolidays';
import { getDateTag } from '@/lib/dateTag';
import { DateTag } from '@/components/ui/DateTag';
import { buildCalendarUrl } from '@/lib/calendar';

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

interface RefInfo {
  text: string;
  refName: string;
  refEmail?: string;
  refPhone?: string;
  refWhatsapp?: string;
  isEjmFamily?: boolean;
  numberOfKids?: number;
  kidAges?: number[];
}

export function ExpandableBabysitterCard({
  appointment,
  info,
  variant,
  isReturning,
  isPreferred,
  onTogglePreferred,
  onCancel,
  onEdit,
  onResubmit,
  onLeaveReference,
  onAccept,
  onDecline,
  existingReference,
}: {
  appointment: AppointmentDoc;
  info?: BabysitterSummary;
  variant: string;
  isReturning?: boolean;
  isPreferred?: boolean;
  onTogglePreferred?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onResubmit?: () => void;
  onLeaveReference?: () => void;
  /** Babysitter-initiated pendings only (issue #207 PR3): the family answers. */
  onAccept?: () => void;
  onDecline?: () => void;
  existingReference?: ReferenceDoc;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const [expanded, setExpanded] = useState(false);
  const badgeLabels = useBadgeLabels();
  const { periods: holidayPeriods } = useHolidays();
  const name = info?.name || t('familyDashboard.babysitterFallback');
  // A babysitter who answered one of this family's published searches
  // (issue #207 PR3). The roles are flipped: the FAMILY accepts or declines,
  // and edit/cancel — which act on a request the family authored — do not
  // apply. Absent initiatedBy means 'family' (every pre-PR3 doc).
  const babysitterInitiated = appointment.initiatedBy === 'babysitter';

  // References for this babysitter
  const [refs, setRefs] = useState<RefInfo[]>([]);
  const [expandedRefIds, setExpandedRefIds] = useState<Set<string>>(new Set());

  // Appointment notes (issue #238, parity B2 — study's session notes adopted
  // into sit). The FAMILY authors the pre-note here; the babysitter's
  // post-note is read-only. The card owns the dialog + callable (it already
  // owns its own reference reads); the dashboard's live onSnapshot refreshes
  // the note after a save, so the save is non-optimistic and there is no
  // local patching.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteRemoveOpen, setNoteRemoveOpen] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // The pre-note window mirrors the callable's gate (UX only, and fails
  // CLOSED like the server): a confirmed recurring arrangement always (there
  // is always a next occurrence); anything else needs a date + startTime
  // whose Paris wall-clock start has not passed — a doc missing them would
  // only earn a guaranteed failed-precondition.
  const canEditPre =
    variant === 'confirmed' &&
    (appointment.type === 'recurring'
      ? true
      : Boolean(appointment.date && appointment.startTime) &&
        !hasStarted(appointment.date, appointment.startTime));

  const callSetNote = (text: string) => {
    const fn = httpsCallable<
      { appointmentId: string; kind: 'pre'; text: string },
      { success: boolean }
    >(functions, 'setAppointmentNote');
    return fn({ appointmentId: appointment.appointmentId, kind: 'pre', text });
  };

  const saveNote = async (text: string) => {
    setNoteError(null);
    setNoteSaving(true);
    try {
      await callSetNote(text);
      setNoteOpen(false);
    } catch {
      setNoteError(t('familyDashboard.notes.error'));
    } finally {
      setNoteSaving(false);
    }
  };

  // Erasure path (issue #255 carve-out): the callable lets the AUTHOR clear
  // their own note at any time, so once the edit window closes the card
  // swaps the add/edit affordance for a remove one. Confirmation and errors
  // go through the shared Dialog + notes.error copy, like every other flow
  // (native confirm/alert render OS chrome and can be suppressed entirely).
  const removeNote = async () => {
    setNoteError(null);
    setNoteSaving(true);
    try {
      await callSetNote('');
      setNoteRemoveOpen(false);
    } catch {
      setNoteError(t('familyDashboard.notes.error'));
    } finally {
      setNoteSaving(false);
    }
  };

  useEffect(() => {
    if (!expanded || !appointment.babysitterUserId) return;
    getDocs(fsQuery(
      collection(db, 'references'),
      fsWhere('babysitterUserId', '==', appointment.babysitterUserId),
      fsWhere('status', 'in', ['approved', 'published']),
      fsLimit(10)
    )).then((snap) => {
      setRefs(snap.docs.map((d) => {
        const data = d.data();
        return {
          text: data.referenceText || data.note || '',
          refName: data.submittedByName || data.refName || '',
          refEmail: data.refEmail || undefined,
          refPhone: data.refPhone || undefined,
          refWhatsapp: data.refWhatsapp || undefined,
          isEjmFamily: data.isEjmFamily || false,
          numberOfKids: data.numberOfKids || undefined,
          kidAges: data.kidAges || undefined,
        };
      }));
    }).catch(() => {});
  }, [expanded, appointment.babysitterUserId]);

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
              {isPreferred && <span title="Preferred">❤️</span>}
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
            {/* Legible WITHOUT expanding: this request came from the sitter. */}
            {babysitterInitiated && (
              <span className="block text-xs font-medium text-brand-600">
                {t('familyDashboard.answeredPublishedSearch')}
              </span>
            )}
            <DateTag tag={getDateTag(appointment.date || '', appointment.startTime || '', holidayPeriods)} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end gap-1">
            <Badge variant={badgeVariants[variant]}>{badgeLabels[variant]}</Badge>
            {appointment.modified && (
              <Badge variant="blue">{t('appointment.modified')}</Badge>
            )}
          </div>
          <ChevronRightIcon className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* The notes block deliberately does NOT sit behind `info &&`: `info`
          comes from a per-uid profile getDoc that silently swallows a
          missing doc (e.g. the sitter was hard-deleted and babysitterUserId
          is 'deleted') or a permission error, and the round-4 erasure
          affordance must not vanish with an unrelated profile fetch
          (round-8 review). The rest of the expanded view degrades fine. */}
      {expanded && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          {info && (<>
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
            <div className="mt-2 rounded-lg bg-gray-50 p-3">
              <p className="mb-1 text-xs font-medium text-gray-500">{t('familyDashboard.contactLabel')}</p>
              {info.contactEmail && (
                <a href={`mailto:${info.contactEmail}`} className="flex items-center gap-2 py-1.5 text-xs text-brand-600 active:bg-gray-100">
                  <span>📧</span> <span>{info.contactEmail}</span>
                </a>
              )}
              {info.contactPhone && (
                <a href={`tel:${info.contactPhone}`} className="flex items-center gap-2 py-1.5 text-xs text-brand-600 active:bg-gray-100">
                  <span>📞</span> <span>{info.contactPhone}</span>
                </a>
              )}
            </div>
          )}

          {/* References */}
          {refs.length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700"><span className="text-green-600">✓</span> {t('references.title')} ({refs.length})</p>
              {refs.map((ref, i) => {
                const refKey = `${appointment.appointmentId}-${i}`;
                const refExpanded = expandedRefIds.has(refKey);
                return (
                  <div key={i} className="mb-1.5 last:mb-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedRefIds((prev) => { const next = new Set(prev); if (refExpanded) next.delete(refKey); else next.add(refKey); return next; }); }}
                      className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-white active:bg-white"
                    >
                      {refExpanded ? '▾' : '▸'} {ref.refName ? `Endorsement from ${ref.refName}` : `Endorsement ${i + 1}`}
                      {ref.isEjmFamily && <span className="ml-1.5 text-blue-600 font-normal">EJM Family</span>}
                    </button>
                    {refExpanded && (
                      <div className="ml-4 mt-1 mb-2 space-y-1">
                        {ref.text && <p className="text-xs text-gray-600 italic">"{ref.text}"</p>}
                        {ref.refEmail && (
                          <a href={`mailto:${ref.refEmail}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-brand-600">
                            <span>📧</span> {ref.refEmail}
                          </a>
                        )}
                        {ref.refPhone && (
                          <a href={`tel:${ref.refPhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-brand-600">
                            <span>📞</span> {ref.refPhone}
                          </a>
                        )}
                        {ref.refWhatsapp && (
                          <a href={`https://wa.me/${ref.refWhatsapp.replace(/[^\d+]/g, '').replace('+', '')}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-green-600">
                            <span>💬</span> {ref.refWhatsapp !== ref.refPhone ? ref.refWhatsapp : 'WhatsApp'}
                          </a>
                        )}
                        {ref.numberOfKids && ref.numberOfKids > 0 && (
                          <p className="text-xs text-gray-500">
                            👶 {ref.numberOfKids} {ref.numberOfKids === 1 ? 'child' : 'children'}
                            {ref.kidAges?.length ? ` (ages ${ref.kidAges.join(', ')})` : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Date/time for non-grouped sections */}
          {variant !== 'pending' && appointment.date && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-500">
                📅 {new Date(appointment.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                {appointment.startTime && appointment.endTime && ` · ${appointment.startTime}–${appointment.endTime}`}
              </p>
              {variant === 'confirmed' && appointment.startTime && appointment.endTime && (
                <a
                  href={buildCalendarUrl(appointment.date, appointment.startTime, appointment.endTime, name, appointment.address ?? undefined)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-brand-600 active:text-brand-800"
                >
                  {t('request.addToCalendar')}
                </a>
              )}
            </div>
          )}

          {onTogglePreferred && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePreferred(); }}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-600 active:text-gray-900"
            >
              <span className="text-base">{isPreferred ? '❤️' : '🤍'}</span>
              {isPreferred ? t('preferred.remove') : t('preferred.add')}
            </button>
          )}

          {/* Babysitter-initiated pending: the family answers it. Accepting
              also releases the address the sitter has not been shown yet. */}
          {babysitterInitiated && variant === 'pending' && (onAccept || onDecline) && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-500">{t('familyDashboard.answeredPublishedSearchDesc')}</p>
              <div className="flex gap-2">
                {onAccept && (
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); onAccept(); }} className="flex-1">
                    {t('request.accept')}
                  </Button>
                )}
                {onDecline && (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onDecline(); }} className="flex-1">
                    {t('request.decline')}
                  </Button>
                )}
              </div>
            </div>
          )}
          {/* Edit is dropped only while a sitter-initiated request is PENDING
              (the family did not author it, so there is nothing of theirs to
              edit). Once accepted it is a mutual commitment like any other
              confirmed sitting, and the family must be able to adjust times
              through modifyAppointment — mirrors the cancel guard below
              (PR #212 review). */}
          {!(babysitterInitiated && variant === 'pending') && (variant === 'pending' || variant === 'confirmed') && onEdit && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                {t('appointment.edit')}
              </Button>
            </div>
          )}
          {!(babysitterInitiated && variant === 'pending') && (variant === 'pending' || variant === 'confirmed') && onCancel && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="w-full">
                {variant === 'pending' ? t('appointment.cancelRequest') : t('appointment.cancel')}
              </Button>
            </div>
          )}
          {variant === 'rejected' && appointment.statusReason === 'declined_by_family' && (
            // WE declined this one (issue #207 PR3). Without saying so the
            // card reads as though the sitter refused us, and Resubmit would
            // silently re-disclose the address to a sitter we just turned
            // down — this PR's whole thesis is that disclosure follows an
            // explicit yes (PR #212 review).
            <p className="mt-3 text-xs text-gray-500">{t('appointment.declinedByYou')}</p>
          )}
          {variant === 'rejected' && appointment.status === 'cancelled'
            && appointment.statusReason === 'cancelled_by_babysitter' && (
            // The sitter withdrew their own contact (issue #207 PR3 made that
            // reachable for a PENDING request). useFamilyAppointments funnels
            // cancelled into rejectedRecent, so without this the family reads
            // "Declined" with no idea who declined (PR #212 review).
            <p className="mt-3 text-xs text-gray-500">{t('appointment.withdrawnBySitter')}</p>
          )}
          {/* Resubmit is gated on the status, not just the variant: cancelled
              appointments also render as `rejected` here, and
              resubmitAppointment rejects anything that is not `rejected` — the
              button could only ever produce an error alert (PR #212 review). */}
          {variant === 'rejected' && onResubmit && appointment.status === 'rejected' && appointment.statusReason !== 'declined_by_family' && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onResubmit(); }}>
                {t('appointment.resubmit')}
              </Button>
            </div>
          )}
          {variant === 'past' && onLeaveReference && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onLeaveReference(); }}>
                {existingReference ? t('references.editMyReference') : t('references.leaveReference')}
              </Button>
            </div>
          )}
          </>)}

          {/* Appointment notes: the family's pre-note (editable within its
              window) + the babysitter's post-note (read-only). Rendered on
              EVERY variant when notes exist (the component returns null
              otherwise): past/rejected cards keep notes visible read-only,
              and even a pending card shows an odd-history note — pending
              cards render forever and the cron's redaction sweep skips
              them, so this is the one place its author can still see and
              remove it (round-6 review coherence note). */}
          <AppointmentNotes
            pre={appointment.preAppointmentNote}
            post={appointment.postAppointmentNote}
            editKind="pre"
            canEdit={canEditPre}
            onEdit={() => { setNoteError(null); setNoteOpen(true); }}
            onRemove={() => { setNoteError(null); setNoteRemoveOpen(true); }}
            copy={{
              fromFamily: t('familyDashboard.notes.fromFamily'),
              fromBabysitter: t('familyDashboard.notes.fromBabysitter'),
              add: t('familyDashboard.notes.add'),
              edit: t('familyDashboard.notes.edit'),
              remove: t('familyDashboard.notes.remove'),
            }}
          />
        </div>
      )}

      {/* Remove-note confirmation (erasure path) — shared Dialog, same error
          copy as the save path. */}
      {/* onClose gated on noteSaving: the shared Dialog closes on backdrop
          click, and dismissing mid-flight would unmount the only thing that
          can render the error of a non-optimistic (erasure!) call. */}
      <Dialog open={noteRemoveOpen} onClose={() => { if (!noteSaving) setNoteRemoveOpen(false); }}>
        <h3 className="mb-2 text-lg font-bold">{t('familyDashboard.notes.removeTitle')}</h3>
        <p className="mb-3 text-sm text-gray-600">{t('familyDashboard.notes.removeDesc')}</p>
        {noteError && <p className="mb-3 text-sm text-brand-600">{noteError}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={noteSaving} onClick={removeNote}>
            {t('familyDashboard.notes.remove')}
          </Button>
          <Button variant="ghost" className="flex-1" disabled={noteSaving} onClick={() => setNoteRemoveOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      <AppointmentNoteDialog
        open={noteOpen}
        title={t('familyDashboard.notes.dialogTitle')}
        description={t('familyDashboard.notes.dialogDesc')}
        placeholder={t('familyDashboard.notes.placeholder')}
        initialText={appointment.preAppointmentNote ?? ''}
        saveLabel={t('familyDashboard.notes.save')}
        cancelLabel={t('common.cancel')}
        maxLength={2000}
        submitting={noteSaving}
        error={noteError}
        onSave={saveNote}
        onClose={() => { if (!noteSaving) setNoteOpen(false); }}
      />
    </Card>
  );
}
