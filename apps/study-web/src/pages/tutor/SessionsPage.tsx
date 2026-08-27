import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot } from '@ejm/shared-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, Button, Badge, TopNav, Spinner, Dialog, useRefetchOnFocus } from '@ejm/shared-ui';
import { RecurringConflictPreview } from '@/components/tutor/RecurringConflictPreview';
import { ReasonModal } from '@/components/sessions/ReasonModal';
import { SessionInstanceList } from '@/components/sessions/SessionInstanceList';
import { SessionNotes } from '@/components/sessions/SessionNotes';
import { SessionNoteDialog } from '@/components/sessions/SessionNoteDialog';
import { humanizeNoticeWindow, isLateCancellationClient } from '@/utils/cancellationPolicy';
import type { StudySessionDoc, StudySessionInstanceDoc } from '@/types/studySession';

const NOTE_MAX = 2000;

/** Shape of a recurring respondToSession result — drives the outcome dialog. */
interface RecurringResult {
  scheduledDates: string[];
  skippedDates: string[];
}

/** What the cancel modal is targeting. */
type CancelTarget =
  | { kind: 'session' | 'series'; session: StudySessionDoc }
  | { kind: 'instance'; session: StudySessionDoc; instance: StudySessionInstanceDoc };

/** What the note dialog is targeting (one_time on the parent, recurring on an instance). */
type NoteTarget = {
  session: StudySessionDoc;
  instance?: StudySessionInstanceDoc;
  initialText: string;
};

/** 3-letter weekday code → the full-name i18n key under `days.*`. */
const DAY_FULL: Record<RecurringSlot['day'], string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

const TERMINAL: StudySessionDoc['status'][] = ['declined', 'cancelled', 'completed'];

/** Paris "YYYY-MM-DD" today (en-CA renders ISO order; tz-correct via runtime). */
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Paris "YYYY-MM-DDTHH:MM" now — a sortable stamp for the note timing window. */
function parisNowStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Has the given Paris wall-clock start (date + HH:MM) already passed? The tutor's
 * post-note becomes writable once this is true (the session has started). */
function hasStarted(date?: string, startTime?: string): boolean {
  if (!date || !startTime) return false;
  return `${date}T${startTime}` <= parisNowStamp();
}

/**
 * Tutor sessions hub. Reads `study-sessions` where `tutorUserId == me` (plus the
 * per-series `instances` subcollection for confirmed recurring series) and
 * presents three sections:
 *   • Pending  — accept / decline (with the recurring conflict preview).
 *   • Upcoming — confirmed one_time sessions and confirmed series interleaved by
 *     date; series expand to their instance list; cancel session / series / date.
 *   • History  — declined / cancelled / completed parents, read-only.
 *
 * INDEX NOTE: the only study-sessions composite keyed on tutorUserId is
 * (tutorUserId, status, date), which cannot serve `where(tutorUserId ==) +
 * orderBy(createdAt)`, so — like the tutor RequestsPage — we query by
 * tutorUserId alone (single-field, always indexed) and sort CLIENT-SIDE.
 * Instances are read via the NESTED per-series path (no collection-group query —
 * the client has no CG rule).
 *
 * Every mutation is NON-OPTIMISTIC: a confirmed session and a cancellation are
 * both commitments, so a row only changes state after its callable resolves; on
 * failure it stays put and re-enables.
 */
export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [instancesBySeries, setInstancesBySeries] = useState<
    Record<string, StudySessionInstanceDoc[]>
  >({});
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<StudySessionDoc | null>(null);
  const [recurringResult, setRecurringResult] = useState<RecurringResult | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Key of the row awaiting the respond callable (a session id).
  const [actingId, setActingId] = useState<string | null>(null);
  // Key of the row awaiting a cancel callable (session id, or `sid::instanceId`).
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  const [ackKey, setAckKey] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  // The note dialog target (the tutor authors the POST-note), plus its in-flight
  // guard and error. Non-optimistic — local state updates from the callable success.
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  // Erasure confirm (issue #255 carve-out): which note a "remove" click targets.
  const [noteRemoveTarget, setNoteRemoveTarget] = useState<{
    session: StudySessionDoc;
    instance?: StudySessionInstanceDoc;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // A mounted guard shared by the initial load and every post-action reload, so a
  // late-resolving fetch never writes state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The page's load, reusable so a successful confirm can re-run it (a confirm
  // materialises server state — recurring instances especially — that a local
  // status flip alone can't show).
  // Monotonic run id — mirrors the family twin: an older in-flight load (or
  // one for a previous uid) must not apply over a newer run now that focus is
  // a third trigger.
  const runIdRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    if (!uid) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid)),
      );
      const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
      rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

      // Load the instance subcollections for ALL recurring series via the
      // nested path — terminal (cancelled/completed) series included, because
      // their per-occurrence notes must stay visible and ERASABLE in history
      // (issue #255; the carve-out is worthless for a note the author can no
      // longer reach). The read MUST be filtered on the instance's
      // denormalized tutorUserId: the security rule proves access per-doc
      // from resource.data.tutorUserId, and an unconstrained list is
      // unprovable → PERMISSION_DENIED. Single-field equality (no composite
      // needed).
      const series = rows.filter((r) => r.type === 'recurring');
      const instanceLists = await Promise.all(
        series.map((s) =>
          getDocs(
            query(
              collection(db, 'study-sessions', s.sessionId, 'instances'),
              where('tutorUserId', '==', uid),
            ),
          ).then((isnap) => ({
            sessionId: s.sessionId,
            rows: isnap.docs.map((d) => d.data() as StudySessionInstanceDoc),
          })),
        ),
      );
      if (!mountedRef.current || runId !== runIdRef.current) return;
      // A successful (re)load clears any prior transient failure — a sticky
      // flag would render the error next to the freshly loaded list.
      setLoadError(false);
      const byId: Record<string, StudySessionInstanceDoc[]> = {};
      for (const { sessionId, rows: irows } of instanceLists) byId[sessionId] = irows;
      setInstancesBySeries(byId);
      setSessions(rows);
    } catch {
      // A THROW is a load failure — surface it, don't conflate it with the
      // tutor having no sessions (the empty state).
      if (mountedRef.current && runId === runIdRef.current) setLoadError(true);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  // Issue #117 tier (a): a returning user re-runs the same load, so an open tab
  // doesn't show a stale inbox.
  useRefetchOnFocus(load);

  // Format a "YYYY-MM-DD" date. Parsed field-by-field (not `new Date(str)`, which
  // reads as UTC midnight and can slip a day in negative offsets).
  const formatDateStr = (s?: string): string => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const respond = async (session: StudySessionDoc, action: 'confirm' | 'decline') => {
    const next: StudySessionDoc['status'] = action === 'confirm' ? 'confirmed' : 'declined';
    setError(null);
    setActingId(session.sessionId);
    try {
      const fn = httpsCallable<
        { sessionId: string; action: 'confirm' | 'decline' },
        { success: boolean; confirmed?: boolean; scheduledDates?: string[]; skippedDates?: string[] }
      >(functions, 'respondToSession');
      const res = await fn({ sessionId: session.sessionId, action });
      // Immediate feedback: flip the row so it leaves Pending without waiting on
      // the reload below.
      setSessions((rs) =>
        (rs ?? []).map((s) => (s.sessionId === session.sessionId ? { ...s, status: next } : s)),
      );
      if (action === 'confirm' && session.type === 'recurring' && res.data.scheduledDates) {
        setRecurringResult({
          scheduledDates: res.data.scheduledDates,
          skippedDates: res.data.skippedDates ?? [],
        });
      }
      // A confirm creates server state the flip can't reflect — a recurring
      // series' instances, and any fields the backend stamps on confirm — so
      // re-run the page's load to show it immediately. A decline creates none.
      if (action === 'confirm') await load();
    } catch (e) {
      setError(mapRespondError(e));
    } finally {
      setActingId(null);
    }
  };

  // Map callable errors by CODE, not message. respondToSession raises the same
  // `failed-precondition` for every "can't claim now" case, so it maps to ONE
  // generic message that quotes none of them.
  const mapRespondError = (e: unknown): string => {
    const code = (e as { code?: string })?.code ?? '';
    if (code.includes('failed-precondition')) return t('tutor.sessions.errorCannotConfirm');
    if (code.includes('permission-denied')) return t('tutor.sessions.errorPermission');
    if (code.includes('not-found')) return t('tutor.sessions.errorNotFound');
    return t('tutor.sessions.actionError');
  };

  const acknowledge = async (sessionId: string) => {
    setAckKey(sessionId);
    setAckError(null);
    try {
      const fn = httpsCallable(functions, 'acknowledgeSessionModification');
      await fn({ sessionId });
      setSessions((prev) =>
        prev ? prev.map((x) => (x.sessionId === sessionId ? { ...x, modified: false } : x)) : prev,
      );
    } catch {
      // A silent failure reads as "the tap didn't register" and invites the
      // same no-op tap again (PR #244 round 3) -- say it failed.
      setAckError(sessionId);
    } finally {
      setAckKey(null);
    }
  };

  const openCancel = (target: CancelTarget) => {
    setCancelError(null);
    setCancelTarget(target);
  };

  const submitCancel = async (reason: string) => {
    if (!cancelTarget) return;
    if (reason.length < 3) return; // client gate; the callable also enforces ≥3
    const { session } = cancelTarget;
    const key =
      cancelTarget.kind === 'instance'
        ? `${session.sessionId}::${cancelTarget.instance.instanceId}`
        : session.sessionId;
    setCancelError(null);
    setCancelKey(key);
    try {
      if (cancelTarget.kind === 'instance') {
        const fn = httpsCallable<
          { sessionId: string; instanceId: string; reason: string },
          { success: boolean }
        >(functions, 'cancelSessionInstance');
        await fn({
          sessionId: session.sessionId,
          instanceId: cancelTarget.instance.instanceId,
          reason,
        });
        setInstancesBySeries((m) => ({
          ...m,
          [session.sessionId]: (m[session.sessionId] ?? []).map((i) =>
            i.instanceId === cancelTarget.instance.instanceId
              ? { ...i, status: 'cancelled', statusReason: 'cancelled_by_tutor' }
              : i,
          ),
        }));
      } else {
        const fn = httpsCallable<{ sessionId: string; reason: string }, { success: boolean }>(
          functions,
          'cancelSession',
        );
        await fn({ sessionId: session.sessionId, reason });
        setSessions((rs) =>
          (rs ?? []).map((s) =>
            s.sessionId === session.sessionId ? { ...s, status: 'cancelled' } : s,
          ),
        );
      }
      setCancelTarget(null);
    } catch {
      setCancelError(t('tutor.sessions.actionError'));
    } finally {
      setCancelKey(null);
    }
  };

  const noteCopy = {
    fromFamily: t('tutor.sessions.notes.fromFamily'),
    fromTutor: t('tutor.sessions.notes.fromTutor'),
    add: t('tutor.sessions.notes.add'),
    edit: t('tutor.sessions.notes.edit'),
    remove: t('tutor.sessions.notes.remove'),
  };

  const openNote = (target: NoteTarget) => {
    setNoteError(null);
    setNoteTarget(target);
  };

  // Save (or clear) the tutor's POST-note. Non-optimistic: local state changes
  // only after the callable resolves. Empty text clears the note (field removed).
  const submitNote = async (text: string) => {
    if (!noteTarget) return;
    const { session, instance } = noteTarget;
    const trimmed = text.trim();
    setNoteError(null);
    setNoteSaving(true);
    try {
      const fn = httpsCallable<
        { sessionId: string; instanceId?: string; kind: 'post'; text: string },
        { success: boolean }
      >(functions, 'setSessionNote');
      await fn({
        sessionId: session.sessionId,
        ...(instance ? { instanceId: instance.instanceId } : {}),
        kind: 'post',
        text,
      });
      patchLocalNote(session, instance, trimmed.length ? trimmed : undefined);
      setNoteTarget(null);
    } catch {
      setNoteError(t('tutor.sessions.notes.error'));
    } finally {
      setNoteSaving(false);
    }
  };

  /** Reflect a saved/cleared POST-note in local state (non-optimistic: called
   * only after the callable resolves). */
  const patchLocalNote = (
    session: StudySessionDoc,
    instance: StudySessionInstanceDoc | undefined,
    applied: string | undefined,
  ) => {
    if (instance) {
      setInstancesBySeries((m) => ({
        ...m,
        [session.sessionId]: (m[session.sessionId] ?? []).map((i) =>
          i.instanceId === instance.instanceId ? { ...i, postSessionNote: applied } : i,
        ),
      }));
    } else {
      setSessions((rs) =>
        (rs ?? []).map((s) =>
          s.sessionId === session.sessionId ? { ...s, postSessionNote: applied } : s,
        ),
      );
    }
  };

  // Erasure path (issue #255 carve-out, mirrors sit): the callable lets the
  // AUTHOR clear their own note at any time, so once the edit window closes
  // the card swaps the add/edit affordance for a remove one. Confirmation and
  // errors go through the shared Dialog + notes.error copy.
  const removeNote = async () => {
    if (!noteRemoveTarget) return;
    const { session, instance } = noteRemoveTarget;
    setNoteError(null);
    setNoteSaving(true);
    try {
      const fn = httpsCallable<
        { sessionId: string; instanceId?: string; kind: 'post'; text: string },
        { success: boolean }
      >(functions, 'setSessionNote');
      await fn({
        sessionId: session.sessionId,
        ...(instance ? { instanceId: instance.instanceId } : {}),
        kind: 'post',
        text: '',
      });
      patchLocalNote(session, instance, undefined);
      setNoteRemoveTarget(null);
    } catch {
      setNoteError(t('tutor.sessions.notes.error'));
    } finally {
      setNoteSaving(false);
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

  const slotLine = (slot: RecurringSlot): string =>
    t('tutor.sessions.recurringSlot', {
      day: t(`days.${DAY_FULL[slot.day]}`),
      start: slot.startTime,
      end: slot.endTime,
    });

  const all = sessions ?? [];
  const pending = all.filter((s) => s.status === 'pending');
  const confirmed = all.filter((s) => s.status === 'confirmed');
  const today = parisToday();
  const history = all.filter(
    (s) =>
      TERMINAL.includes(s.status) ||
      // A confirmed one_time whose date has passed renders in NO bucket
      // otherwise (upcoming skips past dates; the completion cron normally
      // flips it within the hour, but a doc without endTime — or one that
      // keeps throwing — never completes and falls out of the cron's window).
      // Its note must stay reachable/erasable (issue #255 round 2).
      (s.type === 'one_time' && s.status === 'confirmed' && !!s.date && s.date < today),
  );

  // Interleave confirmed one_time sessions and confirmed series by date.
  const upcomingEntries: { sortDate: string; el: React.ReactNode }[] = [];
  for (const s of confirmed) {
    if (s.type === 'one_time') {
      if (!s.date || s.date < today) continue;
      upcomingEntries.push({ sortDate: s.date, el: renderOneTimeUpcoming(s) });
    } else {
      const instances = instancesBySeries[s.sessionId] ?? [];
      const upcomingInst = instances
        .filter((i) => i.status === 'scheduled' && i.date >= today)
        .map((i) => i.date)
        .sort();
      const sortDate = upcomingInst[0] ?? '9999-12-31';
      upcomingEntries.push({ sortDate, el: renderSeries(s, instances) });
    }
  }
  upcomingEntries.sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0));

  function renderOneTimeUpcoming(s: StudySessionDoc) {
    return (
      <Card key={s.sessionId}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
          {s.modified && <Badge variant="amber">{t('tutor.sessions.modifiedBadge')}</Badge>}
        </div>
        <p className="text-xs text-gray-500">
          {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
        </p>
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(s.date)} · {s.startTime}
          {s.endTime ? `–${s.endTime}` : ''}
        </p>
        <p className="text-xs text-gray-500">{t(`tutor.sessions.location.${s.location}`)}</p>
        {/* Family modification (issue #234): clearing the flag IS the
            acknowledgement -- sit's appointment contract. */}
        {s.modified && (
          <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            <p>
              {t('tutor.sessions.modifiedDetail', {
                fields: (s.modifiedFields ?? [])
                  .map((f) => t(`tutor.sessions.modifiedFields.${f}`, { defaultValue: f }))
                  .join(', '),
              })}
            </p>
            <Button
              size="sm"
              fullWidth={false}
              className="mt-2"
              disabled={ackKey === s.sessionId}
              onClick={() => acknowledge(s.sessionId)}
            >
              {t('tutor.sessions.acknowledge')}
            </Button>
            {ackError === s.sessionId && (
              <p className="mt-1 text-xs text-red-600">{t('tutor.sessions.ackError')}</p>
            )}
          </div>
        )}
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={cancelKey === s.sessionId}
            onClick={() => openCancel({ kind: 'session', session: s })}
          >
            {t('tutor.sessions.cancelSession')}
          </Button>
        </div>
        <SessionNotes
          pre={s.preSessionNote}
          post={s.postSessionNote}
          editKind="post"
          canEdit={hasStarted(s.date, s.startTime)}
          onEdit={() => openNote({ session: s, initialText: s.postSessionNote ?? '' })}
          onRemove={() => { setNoteError(null); setNoteRemoveTarget({ session: s }); }}
          copy={noteCopy}
        />
      </Card>
    );
  }

  function renderSeries(s: StudySessionDoc, instances: StudySessionInstanceDoc[]) {
    const isOpen = expanded.has(s.sessionId);
    return (
      <Card key={s.sessionId}>
        <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
        <p className="text-xs text-gray-500">
          {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
        </p>
        {s.recurringSlots?.[0] && (
          <p className="mt-1 text-xs text-gray-700">{slotLine(s.recurringSlots[0])}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => toggleExpanded(s.sessionId)}>
            {isOpen ? t('tutor.sessions.hideDates') : t('tutor.sessions.viewDates')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={cancelKey === s.sessionId}
            onClick={() => openCancel({ kind: 'series', session: s })}
          >
            {t('tutor.sessions.cancelSeries')}
          </Button>
        </div>

        {isOpen && (
          <SessionInstanceList
            sessionId={s.sessionId}
            instances={instances}
            today={today}
            cancelKey={cancelKey}
            onCancelInstance={(instance) => openCancel({ kind: 'instance', session: s, instance })}
            formatDate={formatDateStr}
            copy={{
              noOccurrences: t('tutor.sessions.noOccurrences'),
              cancelInstance: t('tutor.sessions.cancelInstance'),
              statusCompleted: t('tutor.sessions.instanceStatus.completed'),
              statusSkipped: t('tutor.sessions.instanceStatus.skipped'),
              statusCancelled: t('tutor.sessions.instanceStatus.cancelled'),
              trial: t('tutor.sessions.trial.badge'),
              cancelledLate: t('sessions.cancelledLateBadge'),
            }}
            renderNotes={(i) => (
              <SessionNotes
                pre={i.preSessionNote}
                post={i.postSessionNote}
                editKind="post"
                canEdit={
                  i.status === 'completed' ||
                  (i.status === 'scheduled' && hasStarted(i.date, i.startTime))
                }
                onEdit={() => openNote({ session: s, instance: i, initialText: i.postSessionNote ?? '' })}
                onRemove={() => { setNoteError(null); setNoteRemoveTarget({ session: s, instance: i }); }}
                copy={noteCopy}
              />
            )}
          />
        )}
      </Card>
    );
  }

  // Client-side late-cancel heads-up for the reason modal (V2 feature 7). Only
  // CONFIRMED commitments can be late; a series warns on its NEXT scheduled date.
  // Approximate-by-design — the server flag on the doc is authoritative.
  const cancelWarning = ((): string | undefined => {
    if (!cancelTarget) return undefined;
    const { session } = cancelTarget;
    if (session.status !== 'confirmed') return undefined;
    const noticeHours = session.cancellationNoticeHours ?? 0;
    if (noticeHours <= 0) return undefined;
    let late = false;
    if (cancelTarget.kind === 'instance') {
      const { date, startTime } = cancelTarget.instance;
      late = isLateCancellationClient(date, startTime, noticeHours);
    } else if (cancelTarget.kind === 'series') {
      const next = (instancesBySeries[session.sessionId] ?? [])
        .filter((i) => i.status === 'scheduled' && i.date >= today)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
      late = !!next && isLateCancellationClient(next.date, next.startTime, noticeHours);
    } else if (session.date) {
      late = isLateCancellationClient(session.date, session.startTime, noticeHours);
    }
    return late
      ? t('sessions.lateCancelWarning', { window: humanizeNoticeWindow(noticeHours, t) })
      : undefined;
  })();

  return (
    <div>
      <TopNav title={t('tutor.sessionsTitle')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {sessions === null && !loadError && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {/* Last-known-good: a refetch blip must not paint an error over a
            rendered list — the error state is only for loads with nothing
            to show (mirrors GovernancePage's dataRef gate). */}
        {loadError && sessions === null && (
          <p className="py-10 text-center text-sm text-brand-600">{t('tutor.sessions.loadError')}</p>
        )}

        {sessions !== null &&
          pending.length === 0 &&
          upcomingEntries.length === 0 &&
          history.length === 0 && (
            <Card>
              <p className="py-4 text-center text-sm text-gray-500">{t('tutor.sessions.empty')}</p>
            </Card>
          )}

        {/* ── Pending (actionable) ── */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.sessions.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pending.map((s) => (
                <Card key={s.sessionId}>
                  <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
                  <p className="text-xs text-gray-500">{s.parentName}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                  </p>

                  <p className="mt-1 text-xs text-gray-600">
                    {s.students.length > 0
                      ? s.students.map((st) => `${st.firstName} (${st.age})`).join(', ')
                      : t('tutor.sessions.studentsOnAccept')}
                  </p>

                  <div className="mt-2 space-y-0.5 text-xs text-gray-700">
                    {s.type === 'one_time' ? (
                      <p>
                        {formatDateStr(s.date)} · {s.startTime}
                        {s.endTime ? `–${s.endTime}` : ''}
                      </p>
                    ) : (
                      <>
                        {s.recurringSlots?.[0] && <p>{slotLine(s.recurringSlots[0])}</p>}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {s.trialFirstSession && (
                            <Badge variant="blue">{t('tutor.sessions.trial.badge')}</Badge>
                          )}
                          {s.schoolWeeksOnly && (
                            <Badge variant="gray">{t('tutor.sessions.schoolWeeksOnly')}</Badge>
                          )}
                          {s.endDate && (
                            <span className="text-gray-500">
                              {t('tutor.sessions.until', { date: formatDateStr(s.endDate) })}
                            </span>
                          )}
                        </div>
                        {s.trialFirstSession && (
                          <p className="text-gray-500">{t('tutor.sessions.trial.request')}</p>
                        )}
                      </>
                    )}
                    <p>
                      {t(`tutor.sessions.location.${s.location}`)} ·{' '}
                      {t('tutor.sessions.rate', { rate: s.rate })}
                    </p>
                  </div>

                  {s.type === 'recurring' && <RecurringConflictPreview session={s} />}

                  {s.message && (
                    <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                      {s.message}
                    </p>
                  )}

                  {s.proposedBy === 'provider' ? (
                    // The tutor's OWN proposal — the family accepts/declines. The
                    // tutor may only withdraw it (cancelSession); NO accept/decline.
                    <>
                      <p className="mt-2 text-xs text-amber-700">
                        {t('tutor.sessions.awaitingFamily')}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelKey === s.sessionId}
                          onClick={() => openCancel({ kind: 'session', session: s })}
                        >
                          {t('tutor.sessions.cancelSession')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        disabled={actingId === s.sessionId}
                        onClick={() => respond(s, 'confirm')}
                      >
                        {t('tutor.sessions.accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actingId === s.sessionId}
                        onClick={() => setDeclineTarget(s)}
                      >
                        {t('tutor.sessions.decline')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Upcoming (confirmed one_time + series, interleaved by date) ── */}
        {upcomingEntries.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.sessions.upcomingTitle')}
            </h2>
            <div className="space-y-3">{upcomingEntries.map((e) => e.el)}</div>
          </div>
        )}

        {/* ── History (read-only) ── */}
        {history.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.sessions.historyTitle')}
            </h2>
            <div className="space-y-3">
              {history.map((s) => (
                <Card key={s.sessionId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {s.type === 'one_time' && s.lateCancellation && (
                        <Badge variant="amber">{t('sessions.cancelledLateBadge')}</Badge>
                      )}
                      <Badge variant="gray">{t(`tutor.sessions.status.${s.status}`)}</Badge>
                    </div>
                  </div>
                  {/* Any settled one_time keeps its notes visible (not just
                      completed): a cancelled session's note is exactly the
                      one its author must still be able to see and REMOVE
                      (issue #255 — mirrors sit's every-variant rendering).
                      Content edits stay completed-only (the post window);
                      the component self-nulls when empty. */}
                  {s.type === 'one_time' && (
                    <SessionNotes
                      pre={s.preSessionNote}
                      post={s.postSessionNote}
                      editKind="post"
                      canEdit={
                        s.status === 'completed' ||
                        // The stranded shape above: confirmed + started keeps
                        // the post window open server-side.
                        (s.status === 'confirmed' && hasStarted(s.date, s.startTime))
                      }
                      onEdit={() => openNote({ session: s, initialText: s.postSessionNote ?? '' })}
                      onRemove={() => { setNoteError(null); setNoteRemoveTarget({ session: s }); }}
                      copy={noteCopy}
                    />
                  )}
                  {/* A terminal SERIES keeps its per-occurrence notes
                      reachable too (issue #255 round 1): each noted
                      occurrence renders read-only with the erasure
                      affordance — otherwise the notes strand the moment the
                      series completes or is cancelled, with no redaction
                      backstop in study. */}
                  {s.type === 'recurring' &&
                    (instancesBySeries[s.sessionId] ?? [])
                      .filter((i) => i.preSessionNote != null || i.postSessionNote != null)
                      .map((i) => (
                        <div key={i.instanceId}>
                          <p className="mt-3 text-[11px] font-medium text-gray-500">
                            {formatDateStr(i.date)}
                          </p>
                          <SessionNotes
                            pre={i.preSessionNote}
                            post={i.postSessionNote}
                            editKind="post"
                            canEdit={false}
                            onEdit={() => {}}
                            onRemove={() => { setNoteError(null); setNoteRemoveTarget({ session: s, instance: i }); }}
                            copy={noteCopy}
                          />
                        </div>
                      ))}
                  {/* Completed work → offer a fresh proposal to the same family. */}
                  {s.status === 'completed' && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(`/tutor/propose/${s.familyId}`, {
                            state: {
                              familyName: s.familyName,
                              subject: s.subject,
                              level: s.level,
                            },
                          })
                        }
                      >
                        {t('tutor.sessions.propose.cta')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Decline confirmation (no reason — a decline carries none) ── */}
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.sessions.confirmDeclineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('tutor.sessions.confirmDeclineDesc')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={actingId !== null}
            onClick={() => {
              const target = declineTarget;
              setDeclineTarget(null);
              if (target) respond(target, 'decline');
            }}
          >
            {t('tutor.sessions.confirmDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      {/* ── Cancellation (reason required, ≥3 chars) ── */}
      <ReasonModal
        open={cancelTarget !== null}
        title={
          cancelTarget?.kind === 'series'
            ? t('tutor.sessions.cancelSeriesTitle')
            : cancelTarget?.kind === 'instance'
              ? t('tutor.sessions.cancelInstanceTitle')
              : t('tutor.sessions.cancelTitle')
        }
        description={t('tutor.sessions.cancelDesc')}
        placeholder={t('tutor.sessions.cancelReasonPlaceholder')}
        confirmLabel={t('tutor.sessions.cancelConfirm')}
        keepLabel={t('tutor.sessions.cancelKeep')}
        submitting={cancelKey !== null}
        error={cancelError}
        warning={cancelWarning}
        onConfirm={submitCancel}
        onClose={() => setCancelTarget(null)}
      />

      {/* ── Session note (tutor authors the post-note) ── */}
      {/* Remove-note confirmation (erasure path, issue #255) — shared Dialog,
          same error copy as the save path. onClose gated on noteSaving: the
          Dialog closes on backdrop click, and dismissing mid-flight would
          unmount the only thing that can render the error of a
          non-optimistic (erasure!) call. */}
      <Dialog open={noteRemoveTarget !== null} onClose={() => { if (!noteSaving) setNoteRemoveTarget(null); }}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.sessions.notes.removeTitle')}</h3>
        <p className="mb-3 text-sm text-gray-600">{t('tutor.sessions.notes.removeDesc')}</p>
        {noteError && <p className="mb-3 text-sm text-brand-600">{noteError}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={noteSaving} onClick={removeNote}>
            {t('tutor.sessions.notes.remove')}
          </Button>
          <Button variant="ghost" className="flex-1" disabled={noteSaving} onClick={() => setNoteRemoveTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      <SessionNoteDialog
        open={noteTarget !== null}
        title={t('tutor.sessions.notes.dialogTitle')}
        description={t('tutor.sessions.notes.dialogDesc')}
        placeholder={t('tutor.sessions.notes.placeholder')}
        initialText={noteTarget?.initialText ?? ''}
        saveLabel={t('tutor.sessions.notes.save')}
        cancelLabel={t('common.cancel')}
        maxLength={NOTE_MAX}
        submitting={noteSaving}
        error={noteError}
        onSave={submitNote}
        onClose={() => setNoteTarget(null)}
      />

      {/* ── Recurring confirm result ── */}
      <Dialog open={recurringResult !== null} onClose={() => setRecurringResult(null)}>
        {recurringResult && (
          <>
            <h3 className="mb-2 text-lg font-bold">{t('tutor.sessions.result.title')}</h3>
            <p className="mb-3 text-sm text-gray-600">
              {t('tutor.sessions.result.summary', {
                scheduled: recurringResult.scheduledDates.length,
                total: recurringResult.scheduledDates.length + recurringResult.skippedDates.length,
              })}
            </p>
            {recurringResult.skippedDates.length > 0 && (
              <div className="mb-4 rounded-lg bg-amber-50 p-3">
                <p className="mb-1 text-xs font-semibold text-amber-800">
                  {t('tutor.sessions.result.skippedTitle')}
                </p>
                <ul className="space-y-0.5">
                  {recurringResult.skippedDates.map((d) => (
                    <li key={d} className="text-xs text-amber-700">
                      {formatDateStr(d)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button className="w-full" onClick={() => setRecurringResult(null)}>
              {t('common.done')}
            </Button>
          </>
        )}
      </Dialog>
    </div>
  );
}
