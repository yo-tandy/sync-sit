import { useState, useEffect, useCallback, useRef } from 'react';
import { SESSION_LENGTHS } from '@ejm/study-core';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot, KidDoc } from '@ejm/shared-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import type { TutorEndorsementDoc } from '@ejm/study-core';
import {
  Card,
  Button,
  Badge,
  TopNav,
  Spinner,
  Dialog,
  Checkbox,
  useRefetchOnFocus,
  EmptyState,
  CalendarIcon,
} from '@ejm/shared-ui';
import { ReasonModal } from '@/components/sessions/ReasonModal';
import { SessionInstanceList } from '@/components/sessions/SessionInstanceList';
import { SessionNotes } from '@/components/sessions/SessionNotes';
import { SessionNoteDialog } from '@/components/sessions/SessionNoteDialog';
import { EndorseTutorDialog } from '@/components/family/EndorseTutorDialog';
import { humanizeNoticeWindow, isLateCancellationClient } from '@/utils/cancellationPolicy';
import type { StudySessionDoc, StudySessionInstanceDoc } from '@/types/studySession';

const NOTE_MAX = 2000;

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

/** Has the given Paris wall-clock start (date + HH:MM) already passed? The
 * pre-note edit window closes once this is true (the family's ask is moot). */
function hasStarted(date?: string, startTime?: string): boolean {
  if (!date || !startTime) return false;
  return `${date}T${startTime}` <= parisNowStamp();
}

/**
 * Family sessions hub — the family-perspective mirror of the tutor SessionsPage.
 * Reads `study-sessions` where `familyId == mine` (single-field query, sorted
 * CLIENT-SIDE — the same index constraint the tutor page documents) plus the
 * per-series `instances` subcollection via the NESTED path (no collection-group
 * rule client-side). Three sections:
 *   • Pending  — awaiting the tutor's confirmation; the family may cancel.
 *   • Upcoming — confirmed one_time + series interleaved by date; series expand
 *     to their instances (per-date cancel + whole-series cancel).
 *   • History  — declined / cancelled / completed, read-only.
 *
 * Every cancel is NON-OPTIMISTIC and calls the SAME callables as the tutor page
 * (cancelSession / cancelSessionInstance); the backend records the party as
 * cancelled_by_family from the caller's auth. The ReasonModal + instance list
 * are the shared components from components/sessions/*.
 */
export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;
  const defaultRefName = `${userDoc?.firstName ?? ''} ${userDoc?.lastName ?? ''}`.trim();

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [instancesBySeries, setInstancesBySeries] = useState<
    Record<string, StudySessionInstanceDoc[]>
  >({});
  const [loadError, setLoadError] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  // Modify (issue #234): one_time only; dialog state mirrors the cancel flow.
  const [modifyTarget, setModifyTarget] = useState<StudySessionDoc | null>(null);
  const [modifySaving, setModifySaving] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [mDate, setMDate] = useState('');
  const [mStart, setMStart] = useState('');
  const [mLength, setMLength] = useState(60);
  const [mMessage, setMMessage] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Key of the row awaiting a cancel callable (session id, or `sid::instanceId`).
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  // The note dialog target (the family authors the PRE-note), plus its in-flight
  // guard and error. Non-optimistic — local state updates from the callable success.
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // tutorUserIds this family has already endorsed (from their own references) —
  // completed work with a tutor in this set shows no endorse prompt.
  const [endorsedTutors, setEndorsedTutors] = useState<Set<string>>(new Set());
  // The completed session whose endorse dialog is open, or null.
  const [endorsing, setEndorsing] = useState<StudySessionDoc | null>(null);

  // ── Provider-proposal response (V1.1 feature 3) ──
  // The family's kids (for the accept student-picker), the accept/decline dialog
  // targets, the picked students, and the in-flight/error state. NON-OPTIMISTIC:
  // a proposal row only changes state after respondToSession resolves.
  const [kids, setKids] = useState<{ kidId: string; firstName: string; age: number }[]>([]);
  const [acceptTarget, setAcceptTarget] = useState<StudySessionDoc | null>(null);
  const [declineTarget, setDeclineTarget] = useState<StudySessionDoc | null>(null);
  const [selectedKids, setSelectedKids] = useState<Set<string>>(new Set());
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState<string | null>(null);

  // A mounted guard shared by the initial load and every focus-triggered
  // refetch, so a late-resolving fetch never writes state after unmount
  // (mirrors the tutor SessionsPage).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The page's load, reusable so a returning user re-runs it (issue #117 tier a).
  // Monotonic run id: an in-flight load for a PREVIOUS familyId (or an older
  // run of the same one) must not apply after a newer run started — mountedRef
  // alone is unmount-scoped, not per-run.
  const runIdRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    if (!familyId) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'study-sessions'), where('familyId', '==', familyId)),
      );
      const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
      rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

      // Load instance subcollections for confirmed recurring series via the
      // nested path. The read MUST be filtered on the instance's denormalized
      // familyId: the security rule proves access per-doc from
      // resource.data.familyId, and an unconstrained list is unprovable →
      // PERMISSION_DENIED. Single-field equality (no composite needed).
      const series = rows.filter((r) => r.status === 'confirmed' && r.type === 'recurring');
      const instanceLists = await Promise.all(
        series.map((s) =>
          getDocs(
            query(
              collection(db, 'study-sessions', s.sessionId, 'instances'),
              where('familyId', '==', familyId),
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
      // A THROW is a load failure — surface it honestly rather than
      // conflating it with the family having no sessions (the empty state).
      if (mountedRef.current && runId === runIdRef.current) setLoadError(true);
    }
  }, [familyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Issue #117 tier (a): a returning user re-runs the same load, so an open tab
  // doesn't show a stale sessions list.
  useRefetchOnFocus(load);

  // This family's submitted endorsements, to gate the post-completion prompt.
  // Equality-only (submittedByFamilyId + appSource) — no composite needed — and
  // we only need the tutor ids, so no sort. Mirrors the family RequestsPage query.
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'references'),
        where('submittedByFamilyId', '==', familyId),
        where('appSource', '==', 'study'),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs.map((d) => d.data() as TutorEndorsementDoc);
        setEndorsedTutors(new Set(rows.map((r) => r.tutorUserId)));
      })
      .catch(() => {
        // A denied/failed endorsements read must not block sessions — fall back to
        // "none endorsed" (the worst case is offering a prompt the callable then
        // rejects with already-exists, which the dialog handles gracefully).
        if (!cancelled) setEndorsedTutors(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  const markEndorsed = (tutorUserId: string) =>
    setEndorsedTutors((prev) => new Set(prev).add(tutorUserId));

  // Load the family's kids (for the proposal accept picker), like BookSessionPage.
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getDocs(collection(db, 'families', familyId, 'kids'))
      .then((snap) => {
        if (cancelled) return;
        setKids(
          snap.docs.map((d) => {
            const k = d.data() as KidDoc;
            return { kidId: d.id, firstName: k.firstName, age: k.age };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setKids([]);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  const openAccept = (s: StudySessionDoc) => {
    setRespondError(null);
    setSelectedKids(new Set());
    setAcceptTarget(s);
  };

  const toggleKid = (id: string) =>
    setSelectedKids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Accept a tutor proposal, picking the attending students. Non-optimistic: the
  // row flips to confirmed only after respondToSession resolves. We merge the
  // chosen roster into the local doc so Upcoming renders it without a reload.
  const submitAccept = async () => {
    if (!acceptTarget || selectedKids.size === 0) return;
    const s = acceptTarget;
    const studentIds = [...selectedKids];
    const chosen = kids
      .filter((k) => selectedKids.has(k.kidId))
      .map((k) => ({ firstName: k.firstName, age: k.age }));
    setRespondError(null);
    setRespondingId(s.sessionId);
    try {
      const fn = httpsCallable<
        { sessionId: string; action: 'confirm'; studentIds: string[] },
        { success: boolean }
      >(functions, 'respondToSession');
      await fn({ sessionId: s.sessionId, action: 'confirm', studentIds });
      setSessions((rs) =>
        (rs ?? []).map((x) =>
          x.sessionId === s.sessionId ? { ...x, status: 'confirmed', students: chosen } : x,
        ),
      );
      setAcceptTarget(null);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? '';
      setRespondError(
        code.includes('failed-precondition')
          ? t('family.sessions.proposalErrorSlot')
          : t('family.sessions.proposalError'),
      );
    } finally {
      setRespondingId(null);
    }
  };

  // Decline a tutor proposal (no reason — a decline carries none). Non-optimistic.
  const submitDecline = async () => {
    if (!declineTarget) return;
    const s = declineTarget;
    setRespondError(null);
    setRespondingId(s.sessionId);
    try {
      const fn = httpsCallable<{ sessionId: string; action: 'decline' }, { success: boolean }>(
        functions,
        'respondToSession',
      );
      await fn({ sessionId: s.sessionId, action: 'decline' });
      setSessions((rs) =>
        (rs ?? []).map((x) => (x.sessionId === s.sessionId ? { ...x, status: 'declined' } : x)),
      );
      setDeclineTarget(null);
    } catch {
      setRespondError(t('family.sessions.proposalError'));
    } finally {
      setRespondingId(null);
    }
  };

  // Format a "YYYY-MM-DD" date field-by-field (never `new Date(str)`, which reads
  // as UTC midnight and can slip a day in negative offsets).
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

  const openModify = (session: StudySessionDoc) => {
    setModifyTarget(session);
    setMDate(session.date ?? '');
    setMStart(session.startTime ?? '');
    setMLength(session.sessionLengthMinutes ?? 60);
    setMMessage(session.message ?? '');
    setModifyError(null);
  };

  const submitModify = async () => {
    if (!modifyTarget) return;
    setModifySaving(true);
    setModifyError(null);
    try {
      const fn = httpsCallable(functions, 'modifySession');
      await fn({
        sessionId: modifyTarget.sessionId,
        date: mDate,
        startTime: mStart,
        sessionLengthMinutes: mLength,
        message: mMessage.trim() === '' ? undefined : mMessage.trim(),
      });
      setModifyTarget(null);
      void load();
    } catch (err) {
      const reason = (err as { details?: { reason?: string } })?.details?.reason;
      setModifyError(
        reason === 'time_unavailable'
          ? t('family.sessions.modifyTimeUnavailable')
          : t('family.sessions.actionError'),
      );
    } finally {
      setModifySaving(false);
    }
  };

  const openCancel = (target: CancelTarget) => {
    setCancelError(null);
    setCancelTarget(target);
  };

  const submitCancel = async (reason: string) => {
    if (!cancelTarget || reason.length < 3) return;
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
        await fn({ sessionId: session.sessionId, instanceId: cancelTarget.instance.instanceId, reason });
        setInstancesBySeries((m) => ({
          ...m,
          [session.sessionId]: (m[session.sessionId] ?? []).map((i) =>
            i.instanceId === cancelTarget.instance.instanceId
              ? { ...i, status: 'cancelled', statusReason: 'cancelled_by_family' }
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
      setCancelError(t('family.sessions.actionError'));
    } finally {
      setCancelKey(null);
    }
  };

  const noteCopy = {
    fromFamily: t('family.sessions.notes.fromFamily'),
    fromTutor: t('family.sessions.notes.fromTutor'),
    add: t('family.sessions.notes.add'),
    edit: t('family.sessions.notes.edit'),
  };

  const openNote = (target: NoteTarget) => {
    setNoteError(null);
    setNoteTarget(target);
  };

  // Save (or clear) the family's PRE-note. Non-optimistic: local state changes
  // only after the callable resolves. Empty text clears the note (field removed).
  const submitNote = async (text: string) => {
    if (!noteTarget) return;
    const { session, instance } = noteTarget;
    const trimmed = text.trim();
    setNoteError(null);
    setNoteSaving(true);
    try {
      const fn = httpsCallable<
        { sessionId: string; instanceId?: string; kind: 'pre'; text: string },
        { success: boolean }
      >(functions, 'setSessionNote');
      await fn({
        sessionId: session.sessionId,
        ...(instance ? { instanceId: instance.instanceId } : {}),
        kind: 'pre',
        text,
      });
      const applied = trimmed.length ? trimmed : undefined;
      if (instance) {
        setInstancesBySeries((m) => ({
          ...m,
          [session.sessionId]: (m[session.sessionId] ?? []).map((i) =>
            i.instanceId === instance.instanceId ? { ...i, preSessionNote: applied } : i,
          ),
        }));
      } else {
        setSessions((rs) =>
          (rs ?? []).map((s) =>
            s.sessionId === session.sessionId ? { ...s, preSessionNote: applied } : s,
          ),
        );
      }
      setNoteTarget(null);
    } catch {
      setNoteError(t('family.sessions.notes.error'));
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
    t('family.sessions.recurringSlot', {
      day: t(`days.${DAY_FULL[slot.day]}`),
      start: slot.startTime,
      end: slot.endTime,
    });

  // "Completed work" the family can endorse: a completed one_time, or a series
  // with at least one completed occurrence. `completed` is the status the hook
  // exists for — this is what turns it into an endorsement.
  const hasCompletedWork = (s: StudySessionDoc): boolean =>
    s.type === 'one_time'
      ? s.status === 'completed'
      : (instancesBySeries[s.sessionId] ?? []).some((i) => i.status === 'completed');

  // The endorse prompt for a session, or null when it isn't completed work or the
  // family has already endorsed this tutor (one endorsement per family+tutor).
  const endorseButton = (s: StudySessionDoc): React.ReactNode => {
    if (!hasCompletedWork(s) || endorsedTutors.has(s.tutorUserId)) return null;
    return (
      <Button size="sm" variant="outline" onClick={() => setEndorsing(s)}>
        {t('family.sessions.endorse', { name: s.tutorName })}
      </Button>
    );
  };

  const all = sessions ?? [];
  const pending = all.filter((s) => s.status === 'pending');
  const confirmed = all.filter((s) => s.status === 'confirmed');
  const history = all.filter((s) => TERMINAL.includes(s.status));
  const today = parisToday();

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

  function sessionHeader(s: StudySessionDoc) {
    return (
      <>
        <p className="text-sm font-semibold text-gray-900">{s.tutorName}</p>
        <p className="text-xs text-gray-500">
          {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
        </p>
        <p className="mt-1 text-xs text-gray-600">
          {s.students.map((st) => `${st.firstName} (${st.age})`).join(', ')}
        </p>
      </>
    );
  }

  function renderOneTimeUpcoming(s: StudySessionDoc) {
    return (
      <Card key={s.sessionId}>
        {sessionHeader(s)}
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(s.date)} · {s.startTime}
          {s.endTime ? `–${s.endTime}` : ''}
        </p>
        <p className="text-xs text-gray-500">{t(`family.sessions.location.${s.location}`)}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" fullWidth={false} onClick={() => openModify(s)}>
            {t('family.sessions.modifySession')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            disabled={cancelKey === s.sessionId}
            onClick={() => openCancel({ kind: 'session', session: s })}
          >
            {t('family.sessions.cancelSession')}
          </Button>
        </div>
        <SessionNotes
          pre={s.preSessionNote}
          post={s.postSessionNote}
          editKind="pre"
          canEdit={!hasStarted(s.date, s.startTime)}
          onEdit={() => openNote({ session: s, initialText: s.preSessionNote ?? '' })}
          copy={noteCopy}
        />
      </Card>
    );
  }

  function renderSeries(s: StudySessionDoc, instances: StudySessionInstanceDoc[]) {
    const isOpen = expanded.has(s.sessionId);
    return (
      <Card key={s.sessionId}>
        {sessionHeader(s)}
        {s.recurringSlots?.[0] && (
          <p className="mt-1 text-xs text-gray-700">{slotLine(s.recurringSlots[0])}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => toggleExpanded(s.sessionId)}>
            {isOpen ? t('family.sessions.hideDates') : t('family.sessions.viewDates')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={cancelKey === s.sessionId}
            onClick={() => openCancel({ kind: 'series', session: s })}
          >
            {t('family.sessions.cancelSeries')}
          </Button>
          {endorseButton(s)}
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
              noOccurrences: t('family.sessions.noOccurrences'),
              cancelInstance: t('family.sessions.cancelInstance'),
              statusCompleted: t('family.sessions.instanceStatus.completed'),
              statusSkipped: t('family.sessions.instanceStatus.skipped'),
              statusCancelled: t('family.sessions.instanceStatus.cancelled'),
              trial: t('family.sessions.trial.badge'),
              cancelledLate: t('sessions.cancelledLateBadge'),
            }}
            renderNotes={(i) => (
              <SessionNotes
                pre={i.preSessionNote}
                post={i.postSessionNote}
                editKind="pre"
                canEdit={i.status === 'scheduled' && !hasStarted(i.date, i.startTime)}
                onEdit={() => openNote({ session: s, instance: i, initialText: i.preSessionNote ?? '' })}
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
      <TopNav title={t('family.sessions.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {sessions === null && !loadError && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {/* Last-known-good: a refetch blip must not paint an error over a
            rendered list — the error state is only for loads with nothing
            to show (mirrors GovernancePage's dataRef gate). */}
        {loadError && sessions === null && (
          <p className="py-10 text-center text-sm text-brand-600">
            {t('family.sessions.loadError')}
          </p>
        )}

        {sessions !== null &&
          pending.length === 0 &&
          upcomingEntries.length === 0 &&
          history.length === 0 && (
            <Card>
              <EmptyState
                icon={<CalendarIcon className="h-6 w-6" />}
                message={t('family.sessions.empty')}
                actionLabel={t('family.sessions.emptyAction')}
                actionTo="/family/search"
              />
            </Card>
          )}

        {/* ── Pending (awaiting the tutor) ── */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.sessions.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pending.map((s) => {
                const isProposal = s.proposedBy === 'provider';
                return (
                  <Card key={s.sessionId}>
                    <p className="text-sm font-semibold text-gray-900">{s.tutorName}</p>
                    <p className="text-xs text-gray-500">
                      {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {s.students.length > 0
                        ? s.students.map((st) => `${st.firstName} (${st.age})`).join(', ')
                        : t('family.sessions.studentsOnAccept')}
                    </p>
                    <div className="mt-2 space-y-0.5 text-xs text-gray-700">
                      {s.type === 'one_time' ? (
                        <p>
                          {formatDateStr(s.date)} · {s.startTime}
                          {s.endTime ? `–${s.endTime}` : ''}
                        </p>
                      ) : (
                        s.recurringSlots?.[0] && <p>{slotLine(s.recurringSlots[0])}</p>
                      )}
                      <p>{t(`family.sessions.location.${s.location}`)}</p>
                    </div>

                    {isProposal ? (
                      // A TUTOR PROPOSAL — the family accepts (picking students) or declines.
                      <>
                        <div className="mt-2">
                          <Badge variant="blue">
                            {t('family.sessions.proposedBy', { name: s.tutorName })}
                          </Badge>
                        </div>
                        {s.message && (
                          <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                            {s.message}
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            disabled={respondingId === s.sessionId}
                            onClick={() => openAccept(s)}
                          >
                            {t('family.sessions.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={respondingId === s.sessionId}
                            onClick={() => {
                              setRespondError(null);
                              setDeclineTarget(s);
                            }}
                          >
                            {t('family.sessions.decline')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-xs text-amber-700">
                          {t('family.sessions.awaitingTutor')}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            fullWidth={false}
                            onClick={() => openModify(s)}
                          >
                            {t('family.sessions.modifySession')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            fullWidth={false}
                            disabled={cancelKey === s.sessionId}
                            onClick={() => openCancel({ kind: 'session', session: s })}
                          >
                            {t('family.sessions.cancelRequest')}
                          </Button>
                        </div>
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Upcoming (confirmed one_time + series, interleaved by date) ── */}
        {upcomingEntries.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.sessions.upcomingTitle')}
            </h2>
            <div className="space-y-3">{upcomingEntries.map((e) => e.el)}</div>
          </div>
        )}

        {/* ── History (read-only) ── */}
        {history.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.sessions.historyTitle')}
            </h2>
            <div className="space-y-3">
              {history.map((s) => {
                const endorse = endorseButton(s);
                return (
                  <Card key={s.sessionId}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{s.tutorName}</p>
                        <p className="text-xs text-gray-500">
                          {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        {s.type === 'one_time' && s.lateCancellation && (
                          <Badge variant="amber">{t('sessions.cancelledLateBadge')}</Badge>
                        )}
                        <Badge variant="gray">{t(`family.sessions.status.${s.status}`)}</Badge>
                      </div>
                    </div>
                    {endorse && <div className="mt-3">{endorse}</div>}
                    {s.type === 'one_time' && s.status === 'completed' && (
                      <SessionNotes
                        pre={s.preSessionNote}
                        post={s.postSessionNote}
                        editKind="pre"
                        canEdit={false}
                        onEdit={() => {}}
                        copy={noteCopy}
                      />
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Endorse-after-completion (the completed status' payoff) ── */}
      {endorsing && (
        <EndorseTutorDialog
          tutorUserId={endorsing.tutorUserId}
          tutorName={endorsing.tutorName}
          subject={endorsing.subject}
          defaultRefName={defaultRefName}
          onClose={() => setEndorsing(null)}
          onEndorsed={() => markEndorsed(endorsing.tutorUserId)}
        />
      )}

      {/* ── Accept a proposal: pick the attending students ── */}
      <Dialog open={acceptTarget !== null} onClose={() => setAcceptTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('family.sessions.proposalAcceptTitle')}</h3>
        <p className="mb-4 text-sm text-gray-600">{t('family.sessions.proposalAcceptDesc')}</p>
        {kids.length === 0 ? (
          <p className="mb-4 text-xs text-gray-500">{t('family.sessions.noStudents')}</p>
        ) : (
          <div className="mb-4 space-y-2">
            {kids.map((k) => (
              <Checkbox
                key={k.kidId}
                checked={selectedKids.has(k.kidId)}
                onChange={() => toggleKid(k.kidId)}
                label={`${k.firstName} (${k.age})`}
              />
            ))}
          </div>
        )}
        {respondError && <p className="mb-2 text-sm text-brand-600">{respondError}</p>}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={selectedKids.size === 0 || respondingId !== null}
            onClick={submitAccept}
          >
            {respondingId !== null
              ? t('family.sessions.proposalAccepting')
              : t('family.sessions.proposalAcceptCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setAcceptTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      {/* ── Decline a proposal (no reason) ── */}
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('family.sessions.proposalDeclineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('family.sessions.proposalDeclineDesc')}</p>
        {respondError && <p className="mb-2 text-sm text-brand-600">{respondError}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={respondingId !== null}
            onClick={submitDecline}
          >
            {t('family.sessions.proposalDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      {/* ── Cancellation (reason required, ≥3 chars) ── */}
      {modifyTarget && (
          <Dialog open onClose={() => setModifyTarget(null)}>
            <h3 className="text-lg font-bold">{t('family.sessions.modifyTitle')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('family.sessions.modifyDesc')}</p>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              {t('family.sessions.modifyDate')}
              <input
                type="date"
                className="mt-1 h-11 w-full rounded-lg border-[1.5px] border-gray-300 px-3"
                value={mDate}
                onChange={(e) => setMDate(e.target.value)}
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              {t('family.sessions.modifyStart')}
              <input
                type="time"
                step={900}
                className="mt-1 h-11 w-full rounded-lg border-[1.5px] border-gray-300 px-3"
                value={mStart}
                onChange={(e) => setMStart(e.target.value)}
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              {t('family.sessions.modifyLength')}
              <select
                className="mt-1 h-11 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-3"
                value={mLength}
                onChange={(e) => setMLength(Number(e.target.value))}
              >
                {SESSION_LENGTHS.map((l) => (
                  <option key={l} value={l}>{l} min</option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              {t('family.sessions.modifyMessage')}
              <textarea
                className="mt-1 w-full rounded-lg border-[1.5px] border-gray-300 p-3 text-sm"
                rows={2}
                value={mMessage}
                onChange={(e) => setMMessage(e.target.value)}
              />
            </label>
            {modifyError && <p className="mt-2 text-sm text-red-600">{modifyError}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={submitModify} disabled={modifySaving} className="flex-1">
                {modifySaving ? t('common.saving') : t('family.sessions.modifySave')}
              </Button>
              <Button variant="ghost" onClick={() => setModifyTarget(null)} className="flex-1">
                {t('common.cancel')}
              </Button>
            </div>
          </Dialog>
        )}
        <ReasonModal
        open={cancelTarget !== null}
        title={
          cancelTarget?.kind === 'series'
            ? t('family.sessions.cancelSeriesTitle')
            : cancelTarget?.kind === 'instance'
              ? t('family.sessions.cancelInstanceTitle')
              : t('family.sessions.cancelTitle')
        }
        description={t('family.sessions.cancelDesc')}
        placeholder={t('family.sessions.cancelReasonPlaceholder')}
        confirmLabel={t('family.sessions.cancelConfirm')}
        keepLabel={t('family.sessions.cancelKeep')}
        submitting={cancelKey !== null}
        error={cancelError}
        warning={cancelWarning}
        onConfirm={submitCancel}
        onClose={() => setCancelTarget(null)}
      />

      {/* ── Session note (family authors the pre-note) ── */}
      <SessionNoteDialog
        open={noteTarget !== null}
        title={t('family.sessions.notes.dialogTitle')}
        description={t('family.sessions.notes.dialogDesc')}
        placeholder={t('family.sessions.notes.placeholder')}
        initialText={noteTarget?.initialText ?? ''}
        saveLabel={t('family.sessions.notes.save')}
        cancelLabel={t('common.cancel')}
        maxLength={NOTE_MAX}
        submitting={noteSaving}
        error={noteError}
        onSave={submitNote}
        onClose={() => setNoteTarget(null)}
      />
    </div>
  );
}
