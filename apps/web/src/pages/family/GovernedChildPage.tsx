import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Card, Button, Badge, TopNav, Spinner, Dialog, Textarea } from '@/components/ui';
import type { RecurringSlot } from '@ejm/shared-core';
import type {
  GovernedChildDetail,
  GovernedSitAppointment,
  GovernedStudySession,
  GovernedSessionInstance,
} from '@/types/guardian';

/** Machine-readable guardian error code from an HttpsError's details, if any. */
function guardianErrorCode(err: unknown): string | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' ? code : null;
}

const TERMINAL_SESSION = ['declined', 'cancelled', 'completed'];
const TERMINAL_APPOINTMENT = ['rejected', 'cancelled', 'completed'];

const STATUS_VARIANT: Record<string, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  confirmed: 'green',
  scheduled: 'green',
};

const DAY_FULL: Record<RecurringSlot['day'], string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/** What the decline-confirmation dialog is targeting (decline-only, both apps). */
type DeclineTarget =
  | { kind: 'sitRequest'; appointmentId: string }
  | { kind: 'sitContact'; requestId: string }
  | { kind: 'studySession'; sessionId: string }
  | { kind: 'studyContact'; requestId: string };

/**
 * What the reason-required cancellation dialog is targeting: a sit
 * appointment, a whole study session/series, one recurring occurrence, or the
 * withdrawal of the kid's own pending study proposal (also a cancelSession —
 * declining one's own proposal is refused server-side).
 */
type CancelTarget =
  | { kind: 'appointment'; appointment: GovernedSitAppointment }
  | { kind: 'session'; session: GovernedStudySession }
  | { kind: 'instance'; session: GovernedStudySession; instance: GovernedSessionInstance }
  | { kind: 'withdraw'; session: GovernedStudySession };

/** What the searchable-toggle confirmation is targeting. */
type SearchableTarget = { app: 'study' | 'sit'; searchable: boolean };

/**
 * Per-kid oversight detail (governance ruling 8: supervising parents see
 * EVERYTHING — appointment/session content, notes, request messages). All
 * data arrives via getGovernedChildDetail; the protective controls ride the
 * EXISTING callables, which authorize the guardian server-side. The study
 * controls are wired cross-app: both function codebases deploy to the ONE
 * Firebase project, so httpsCallable resolves them from here too.
 *
 * Guardian powers are DECLINE-ONLY: this page deliberately renders no accept
 * affordance anywhere (pinned by test). Every control is NON-OPTIMISTIC —
 * state changes only after its callable resolves, then the whole detail is
 * refetched. Copy-adapted from sync-study's GovernedChildPage.
 */
export function GovernedChildPage() {
  const { t, i18n } = useTranslation();
  const { childUid } = useParams<{ childUid: string }>();

  const [detail, setDetail] = useState<GovernedChildDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // True while any control's callable is in flight (disables all controls —
  // the page refetches wholesale afterwards, so per-row granularity buys nothing).
  const [acting, setActing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTarget, setSearchTarget] = useState<SearchableTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!childUid) return;
    try {
      const fn = httpsCallable<{ childUid: string }, GovernedChildDetail>(
        functions,
        'getGovernedChildDetail',
      );
      const res = await fn({ childUid });
      if (!mountedRef.current) return;
      setDetail(res.data);
      setDenied(false);
      setLoadError(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const code = guardianErrorCode(err);
      if (code === 'guardian/not-supervised' || code === 'guardian/not-a-family-parent') {
        setDenied(true);
      } else {
        setLoadError(true);
      }
    }
  }, [childUid]);

  useEffect(() => {
    load();
  }, [load]);

  const formatIso = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // "YYYY-MM-DD" parsed field-by-field (not new Date(str) — UTC-midnight slip).
  const formatDateStr = (s: string | null): string => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const kidName = detail
    ? [detail.child.firstName, detail.child.lastName].filter(Boolean).join(' ')
    : '';
  const firstName = detail?.child.firstName ?? '';

  /** Run one protective control non-optimistically, then refetch the detail. */
  const runControl = async (name: string, payload: Record<string, unknown>) => {
    setActionError(null);
    setActing(true);
    try {
      const fn = httpsCallable(functions, name);
      await fn(payload);
      await load();
      return true;
    } catch {
      if (mountedRef.current) setActionError(t('governance.actionError'));
      return false;
    } finally {
      if (mountedRef.current) setActing(false);
    }
  };

  const openCancel = (target: CancelTarget) => {
    setCancelError(null);
    setCancelReason('');
    setCancelTarget(target);
  };

  const submitCancel = async () => {
    const reason = cancelReason.trim();
    if (!cancelTarget || !reason) return;
    setCancelError(null);
    setActing(true);
    try {
      if (cancelTarget.kind === 'appointment') {
        const fn = httpsCallable(functions, 'cancelAppointment');
        await fn({ appointmentId: cancelTarget.appointment.appointmentId, reason });
      } else if (cancelTarget.kind === 'instance') {
        const fn = httpsCallable(functions, 'cancelSessionInstance');
        await fn({
          sessionId: cancelTarget.session.sessionId,
          instanceId: cancelTarget.instance.instanceId,
          reason,
        });
      } else {
        const fn = httpsCallable(functions, 'cancelSession');
        await fn({ sessionId: cancelTarget.session.sessionId, reason });
      }
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch {
      if (mountedRef.current) setCancelError(t('governance.actionError'));
    } finally {
      if (mountedRef.current) setActing(false);
    }
  };

  const submitDecline = async () => {
    const target = declineTarget;
    setDeclineTarget(null);
    if (!target) return;
    if (target.kind === 'sitRequest') {
      await runControl('respondToRequest', {
        appointmentId: target.appointmentId,
        action: 'decline',
      });
    } else if (target.kind === 'sitContact') {
      await runControl('respondToContactSharing', {
        requestId: target.requestId,
        action: 'decline',
      });
    } else if (target.kind === 'studySession') {
      await runControl('respondToSession', { sessionId: target.sessionId, action: 'decline' });
    } else {
      await runControl('respondToTutorContactRequest', {
        requestId: target.requestId,
        action: 'decline',
      });
    }
  };

  const toggleExpanded = (sessionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  // ── Denied / loading / error shells ──
  if (denied) {
    return (
      <div>
        <TopNav title={t('governance.title')} backTo="/family/governance" />
        <div className="px-5 pt-4 pb-8">
          <Card>
            <h2 className="mb-2 text-lg font-bold text-gray-900">
              {t('governance.child.deniedTitle')}
            </h2>
            <p className="mb-5 text-sm text-gray-600">{t('governance.child.deniedDesc')}</p>
            <Link to="/family/governance" className="block">
              <Button className="w-full">{t('governance.child.deniedBack')}</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div>
        <TopNav title={t('governance.title')} backTo="/family/governance" />
        <div className="px-5 pt-4 pb-8">
          {loadError ? (
            <p className="py-10 text-center text-sm text-red-600">
              {t('governance.child.loadError')}
            </p>
          ) : (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          )}
        </div>
      </div>
    );
  }

  const appointments = detail.sit.appointments;
  const pendingAppointments = appointments.filter((a) => a.status === 'pending');
  const confirmedAppointments = appointments.filter((a) => a.status === 'confirmed');
  const historyAppointments = appointments.filter((a) => TERMINAL_APPOINTMENT.includes(a.status));
  const pendingSitContacts = detail.sit.contactSharingRequests.filter(
    (r) => r.status === 'pending',
  );
  const sessions = detail.study.sessions;
  const pendingSessions = sessions.filter((s) => s.status === 'pending');
  const confirmedSessions = sessions.filter((s) => s.status === 'confirmed');
  const historySessions = sessions.filter((s) => TERMINAL_SESSION.includes(s.status));
  const pendingStudyContacts = detail.study.contactRequests.filter((r) => r.status === 'pending');
  const sitProfile = detail.providerProfiles.babysitter;
  const tutorProfile = detail.providerProfiles.tutor;

  const nothingYet =
    appointments.length === 0 &&
    sessions.length === 0 &&
    pendingSitContacts.length === 0 &&
    pendingStudyContacts.length === 0;

  const appointmentMeta = (a: GovernedSitAppointment) => (
    <>
      <p className="text-sm font-semibold text-gray-900">{a.familyName}</p>
      {a.date && (
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(a.date)}
          {a.startTime ? ` · ${a.startTime}` : ''}
          {a.endTime ? `–${a.endTime}` : ''}
        </p>
      )}
      {a.offeredRate != null && <p className="text-xs text-gray-500">{a.offeredRate} €/h</p>}
      {a.message && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">{a.message}</p>
      )}
      {a.additionalInfo && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">{a.additionalInfo}</p>
      )}
    </>
  );

  const sessionMeta = (s: GovernedStudySession) => (
    <>
      <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
      {s.subject && (
        <p className="text-xs text-gray-500">
          {t(`governance.subjects.${s.subject}`)}
          {s.level ? ` · ${s.level}` : ''}
        </p>
      )}
      {s.date && (
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(s.date)}
          {s.startTime ? ` · ${s.startTime}` : ''}
          {s.endTime ? `–${s.endTime}` : ''}
        </p>
      )}
      {s.type === 'recurring' && s.recurringSlots?.[0] && (
        <p className="mt-1 text-xs text-gray-700">
          {`${t(`days.${DAY_FULL[s.recurringSlots[0].day]}`)} ${s.recurringSlots[0].startTime}–${s.recurringSlots[0].endTime}`}
        </p>
      )}
    </>
  );

  // Ruling 8: message + notes are always rendered when present.
  const sessionTransparency = (s: {
    message: string | null;
    preSessionNote: string | null;
    postSessionNote: string | null;
  }) => (
    <>
      {s.message && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">{s.message}</p>
      )}
      {s.preSessionNote && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          <span className="font-semibold">{t('governance.child.notePre')}: </span>
          {s.preSessionNote}
        </p>
      )}
      {s.postSessionNote && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          <span className="font-semibold">{t('governance.child.notePost')}: </span>
          {s.postSessionNote}
        </p>
      )}
    </>
  );

  const instanceRow = (s: GovernedStudySession, inst: GovernedSessionInstance) => (
    <li key={inst.instanceId} className="border-t border-gray-100 py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-700">
          {formatDateStr(inst.date)}
          {inst.startTime ? ` · ${inst.startTime}` : ''}
          {inst.endTime ? `–${inst.endTime}` : ''}
        </p>
        <Badge variant={STATUS_VARIANT[inst.status] ?? 'gray'}>
          {t(`governance.child.instanceStatus.${inst.status}`)}
        </Badge>
      </div>
      {sessionTransparency({ message: null, ...inst })}
      {inst.status === 'scheduled' && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={acting}
            onClick={() => openCancel({ kind: 'instance', session: s, instance: inst })}
          >
            {t('governance.child.cancelOccurrence')}
          </Button>
        </div>
      )}
    </li>
  );

  const declineButton = (target: DeclineTarget) => (
    <div className="mt-3">
      <Button
        size="sm"
        variant="outline"
        disabled={acting}
        onClick={() => setDeclineTarget(target)}
      >
        {t('governance.child.decline')}
      </Button>
    </div>
  );

  const searchableRow = (app: 'study' | 'sit', searchable: boolean, labelKey: string) => (
    <div className="mt-2 flex items-center justify-between">
      <div className="flex-1 pr-4">
        <p className="text-sm font-medium text-gray-900">{t(labelKey)}</p>
        <p className="text-xs text-gray-500">
          {searchable ? t('governance.searchableOn') : t('governance.searchableOff')}
        </p>
      </div>
      <button
        type="button"
        aria-label={t(
          app === 'sit' ? 'governance.child.toggleSit' : 'governance.child.toggleStudy',
        )}
        disabled={acting}
        onClick={() => setSearchTarget({ app, searchable: !searchable })}
        className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${searchable ? 'bg-red-600' : 'bg-gray-300'}`}
      >
        <div
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${searchable ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );

  const cancelDialogTitle =
    cancelTarget?.kind === 'appointment'
      ? t('governance.child.cancelAppointmentTitle')
      : cancelTarget?.kind === 'withdraw'
        ? t('governance.child.withdrawTitle')
        : cancelTarget?.kind === 'instance'
          ? t('governance.child.cancelOccurrenceTitle')
          : cancelTarget?.session.type === 'recurring'
            ? t('governance.child.cancelSeriesTitle')
            : t('governance.child.cancelTitle');

  const cancelDialogConfirm =
    cancelTarget?.kind === 'appointment'
      ? t('governance.child.cancelAppointmentConfirm')
      : cancelTarget?.kind === 'withdraw'
        ? t('governance.child.withdrawConfirm')
        : cancelTarget?.kind === 'instance'
          ? t('governance.child.cancelOccurrenceConfirm')
          : t('governance.child.cancelConfirm');

  return (
    <div>
      <TopNav title={t('governance.title')} backTo="/family/governance" />

      <div className="px-5 pt-4 pb-8">
        {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

        {/* ── Header: kid identity ── */}
        <Card className="mb-4">
          <p className="text-base font-bold text-gray-900">{kidName}</p>
          <p className="text-xs text-gray-500">
            {detail.child.age != null && `${t('governance.age', { age: detail.child.age })} · `}
            {detail.child.email}
          </p>
          {detail.link.confirmedAt && (
            <p className="mt-1 text-xs text-gray-400">
              {t('governance.child.supervisedSince', { date: formatIso(detail.link.confirmedAt) })}
            </p>
          )}
        </Card>

        {/* ── Profiles + protective searchable toggles ── */}
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('governance.child.profilesTitle')}
        </h2>
        <Card className="mb-4">
          {sitProfile != null ? (
            <>
              {typeof sitProfile.hourlyRate === 'number' && (
                <p className="text-xs text-gray-600">{sitProfile.hourlyRate} €/h</p>
              )}
              {searchableRow(
                'sit',
                (sitProfile as { searchable?: boolean }).searchable === true,
                'governance.profileBabysitter',
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500">{t('governance.child.noBabysitterProfile')}</p>
          )}
          {tutorProfile != null && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">{t('governance.child.studyPresence')}</p>
              {(tutorProfile.subjects ?? []).map((offering) => (
                <p key={offering.subject} className="text-xs text-gray-600">
                  {t(`governance.subjects.${offering.subject}`)} — {offering.levels.join(', ')} —{' '}
                  {offering.rate} €/h
                </p>
              ))}
              {searchableRow('study', tutorProfile.searchable === true, 'governance.profileTutor')}
            </div>
          )}
        </Card>

        {/* ── Schedule summary ── */}
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('governance.child.scheduleTitle')}
        </h2>
        <Card className="mb-4">
          <p className="text-xs text-gray-600">
            {detail.schedule.weekly
              ? t('governance.child.scheduleSet', { count: detail.schedule.overrideCount })
              : t('governance.child.scheduleNone')}
          </p>
        </Card>

        {/* ── Pending requests, both apps (decline-only) ── */}
        {(pendingAppointments.length > 0 ||
          pendingSitContacts.length > 0 ||
          pendingSessions.length > 0 ||
          pendingStudyContacts.length > 0) && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.child.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pendingAppointments.map((a) => (
                <Card key={a.appointmentId}>
                  {appointmentMeta(a)}
                  {declineButton({ kind: 'sitRequest', appointmentId: a.appointmentId })}
                </Card>
              ))}
              {pendingSitContacts.map((r) => (
                <Card key={r.requestId}>
                  <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                  <p className="text-xs text-gray-500">
                    {r.parentName} · {t('governance.child.contactSharingLabel')}
                  </p>
                  {declineButton({ kind: 'sitContact', requestId: r.requestId })}
                </Card>
              ))}
              {pendingSessions.map((s) => (
                <Card key={s.sessionId}>
                  {sessionMeta(s)}
                  {sessionTransparency(s)}
                  {s.proposedBy === 'provider' ? (
                    // The kid's OWN proposal — declining it would be refused
                    // server-side; the guardian may only withdraw it (a cancel).
                    <>
                      <p className="mt-2 text-xs text-amber-700">
                        {t('governance.child.proposedByChild', { name: firstName })}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acting}
                          onClick={() => openCancel({ kind: 'withdraw', session: s })}
                        >
                          {t('governance.child.withdrawProposal')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    declineButton({ kind: 'studySession', sessionId: s.sessionId })
                  )}
                </Card>
              ))}
              {pendingStudyContacts.map((r) => (
                <Card key={r.requestId}>
                  <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                  <p className="text-xs text-gray-500">
                    {r.parentName}
                    {r.subject ? ` · ${t(`governance.subjects.${r.subject}`)}` : ''}
                    {r.level ? ` · ${r.level}` : ''}
                  </p>
                  {r.message && (
                    <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                      {r.message}
                    </p>
                  )}
                  {declineButton({ kind: 'studyContact', requestId: r.requestId })}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Confirmed sit appointments (cancel with reason) ── */}
        {confirmedAppointments.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.child.sitUpcomingTitle')}
            </h2>
            <div className="space-y-3">
              {confirmedAppointments.map((a) => (
                <Card key={a.appointmentId}>
                  {appointmentMeta(a)}
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => openCancel({ kind: 'appointment', appointment: a })}
                    >
                      {t('governance.child.cancelAppointment')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Confirmed study sessions (cancel with reason; wired cross-app) ── */}
        {confirmedSessions.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.child.studyUpcomingTitle')}
            </h2>
            <div className="space-y-3">
              {confirmedSessions.map((s) => (
                <Card key={s.sessionId}>
                  {sessionMeta(s)}
                  {sessionTransparency(s)}
                  <div className="mt-3 flex gap-2">
                    {s.type === 'recurring' && s.instances.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => toggleExpanded(s.sessionId)}>
                        {expanded.has(s.sessionId)
                          ? t('governance.child.hideDates')
                          : t('governance.child.viewDates')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => openCancel({ kind: 'session', session: s })}
                    >
                      {s.type === 'recurring'
                        ? t('governance.child.cancelSeries')
                        : t('governance.child.cancelSession')}
                    </Button>
                  </div>
                  {expanded.has(s.sessionId) && (
                    <ul className="mt-2">{s.instances.map((inst) => instanceRow(s, inst))}</ul>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── History (read-only) ── */}
        {(historyAppointments.length > 0 || historySessions.length > 0) && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.child.historyTitle')}
            </h2>
            <div className="space-y-3">
              {historyAppointments.map((a) => (
                <Card key={a.appointmentId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{appointmentMeta(a)}</div>
                    <Badge variant="gray">{t(`governance.child.status.${a.status}`)}</Badge>
                  </div>
                </Card>
              ))}
              {historySessions.map((s) => (
                <Card key={s.sessionId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{sessionMeta(s)}</div>
                    <Badge variant="gray">{t(`governance.child.status.${s.status}`)}</Badge>
                  </div>
                  {sessionTransparency(s)}
                </Card>
              ))}
            </div>
          </div>
        )}

        {nothingYet && (
          <Card>
            <p className="py-4 text-center text-sm text-gray-500">
              {t('governance.child.emptyItems')}
            </p>
          </Card>
        )}
      </div>

      {/* ── Searchable-toggle confirmation ── */}
      <Dialog open={searchTarget !== null} onClose={() => setSearchTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">
          {searchTarget?.searchable
            ? t('governance.child.confirmShowTitle')
            : t('governance.child.confirmHideTitle')}
        </h3>
        <p className="mb-5 text-sm text-gray-600">
          {searchTarget?.searchable
            ? t('governance.child.confirmShowDesc', { name: firstName })
            : t('governance.child.confirmHideDesc', { name: firstName })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={acting}
            onClick={() => {
              const target = searchTarget;
              setSearchTarget(null);
              if (target && childUid) {
                runControl('guardianSetChildSearchable', {
                  childUid,
                  app: target.app,
                  searchable: target.searchable,
                });
              }
            }}
          >
            {searchTarget?.searchable
              ? t('governance.child.confirmShowCta')
              : t('governance.child.confirmHideCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setSearchTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      {/* ── Decline confirmation (decline-only — there is no accept) ── */}
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('governance.child.confirmDeclineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">
          {t('governance.child.confirmDeclineDesc', { name: firstName })}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={acting} onClick={submitDecline}>
            {t('governance.child.confirmDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
            {t('governance.child.keepRequest')}
          </Button>
        </div>
      </Dialog>

      {/* ── Cancellation / withdrawal (reason required) ── */}
      <Dialog
        open={cancelTarget !== null}
        onClose={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
      >
        <h3 className="mb-2 text-lg font-bold">{cancelDialogTitle}</h3>
        <p className="mb-4 text-sm text-gray-600">
          {cancelTarget?.kind === 'withdraw'
            ? t('governance.child.withdrawDesc', { name: firstName })
            : t('governance.child.cancelDesc', { name: firstName })}
        </p>
        <Textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('governance.child.cancelPlaceholder')}
          required
        />
        {cancelError && <p className="mt-2 text-sm text-red-600">{cancelError}</p>}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={acting || !cancelReason.trim()}
            onClick={submitCancel}
          >
            {cancelDialogConfirm}
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              setCancelTarget(null);
              setCancelReason('');
            }}
          >
            {cancelTarget?.kind === 'withdraw'
              ? t('governance.child.withdrawKeep')
              : t('governance.child.cancelKeep')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
