import { useState, useEffect, useCallback, useRef } from 'react';
import { SESSION_LENGTHS } from '@ejm/study-core';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot, KidDoc } from '@ejm/shared-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getFamilyId } from '@ejm/shared-core';
import type { TutorEndorsementDoc } from '@ejm/study-core';
import {
  Card,
  Button,
  Badge,
  TopNav,
  SkeletonCard,
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
 * rule client-side). Instances are fetched EAGERLY for (a) confirmed (ACTIVE)
 * series in load(), and (b) a COMPLETED series whose tutor this family hasn't
 * endorsed yet, once the endorsedTutors read settles (the effect right below
 * it) — that keeps the endorse prompt on the history card visible without a
 * click. Every other terminal series (declined/cancelled, or completed with
 * an already-endorsed tutor) loads LAZILY on first history-card expand
 * (issue #275) — see load()/loadSeriesInstances/toggleHistorySeries for the
 * split and per-series failure isolation. Three sections:
 *   • Pending  — awaiting the tutor's confirmation; the family may cancel.
 *   • Upcoming — confirmed one_time + series interleaved by date; series expand
 *     to their instances (per-date cancel + whole-series cancel).
 *   • History  — declined / cancelled / completed, read-only; a recurring
 *     series' occurrence notes load lazily on expand (except the
 *     completed-unendorsed case above).
 *
 * Every cancel is NON-OPTIMISTIC and calls the SAME callables as the tutor page
 * (cancelSession / cancelSessionInstance); the backend records the party as
 * cancelled_by_family from the caller's auth. The ReasonModal + instance list
 * are the shared components from components/sessions/*.
 */
export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  // Both membership shapes (PR #345 round 4) — the destination of the
  // dashboard's session rows; see RequestsPage for the same reasoning.
  const familyId = getFamilyId(userDoc);
  const defaultRefName = `${userDoc?.firstName ?? ''} ${userDoc?.lastName ?? ''}`.trim();

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [instancesBySeries, setInstancesBySeries] = useState<
    Record<string, StudySessionInstanceDoc[]>
  >({});
  // Per-series instance load state (issue #275): 'loading' | 'error', keyed by
  // sessionId. Covers BOTH the eager ACTIVE-series fetch in load() (isolated
  // via allSettled so one series' failure can't flip the whole page to
  // loadError) and a TERMINAL series' lazy fetch on first history-card expand.
  // A sessionId absent from this map that is also absent from
  // instancesBySeries simply hasn't been requested yet.
  const [seriesInstanceStatus, setSeriesInstanceStatus] = useState<
    Record<string, 'loading' | 'error'>
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
  const [mLocation, setMLocation] = useState('online');
  const [mMessage, setMMessage] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Key of the row awaiting a cancel callable (session id, or `sid::instanceId`).
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  // The note dialog target (the family authors the PRE-note), plus its in-flight
  // guard and error. Non-optimistic — local state updates from the callable success.
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  // Erasure confirm (issue #255 carve-out): which note a "remove" click targets.
  const [noteRemoveTarget, setNoteRemoveTarget] = useState<{
    session: StudySessionDoc;
    instance?: StudySessionInstanceDoc;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // tutorUserIds this family has already endorsed (from their own references) —
  // completed work with a tutor in this set shows no endorse prompt.
  const [endorsedTutors, setEndorsedTutors] = useState<Set<string>>(new Set());
  // True once the endorsedTutors read has settled (success OR the
  // fallback-to-none-endorsed catch) — the signal the completed-series
  // eager-instances effect below waits on (issue #275 round 2).
  const [endorsedTutorsReady, setEndorsedTutorsReady] = useState(false);
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

  // Fetch ONE series' instances via the nested per-series path. The read MUST
  // be filtered on the instance's denormalized familyId: the security rule
  // proves access per-doc from resource.data.familyId (no parent get()), so
  // this is provable whether the parent series is active or terminal —
  // single-field equality, no composite needed.
  const fetchSeriesInstances = useCallback(
    (sessionId: string) =>
      getDocs(
        query(
          collection(db, 'study-sessions', sessionId, 'instances'),
          where('familyId', '==', familyId),
        ),
      ).then((snap) => snap.docs.map((d) => d.data() as StudySessionInstanceDoc)),
    [familyId],
  );

  // Load (or retry) a single series' instances OUTSIDE the page's main load —
  // the lazy path for a TERMINAL series' first history-card expand (issue
  // #275), and the retry affordance for either an active series whose eager
  // fetch failed or a terminal series whose lazy fetch failed.
  const loadSeriesInstances = useCallback(
    (sessionId: string) => {
      setSeriesInstanceStatus((m) => ({ ...m, [sessionId]: 'loading' }));
      fetchSeriesInstances(sessionId)
        .then((rows) => {
          if (!mountedRef.current) return;
          setInstancesBySeries((m) => ({ ...m, [sessionId]: rows }));
          setSeriesInstanceStatus((m) => {
            const next = { ...m };
            delete next[sessionId];
            return next;
          });
        })
        .catch(() => {
          if (!mountedRef.current) return;
          setSeriesInstanceStatus((m) => ({ ...m, [sessionId]: 'error' }));
        });
    },
    [fetchSeriesInstances],
  );

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    if (!familyId) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'study-sessions'), where('familyId', '==', familyId)),
      );
      const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
      rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

      // Instances (issue #275): eager-load ONLY for ACTIVE (confirmed)
      // recurring series — the ones upcomingEntries actually renders. A
      // 'pending' series has no instances subcollection yet (generateInstances
      // runs on confirm, in respondToSession), so it needs no read at all. A
      // TERMINAL series (declined/cancelled/completed) loads its instances
      // LAZILY the first time its history card is expanded
      // (loadSeriesInstances/toggleHistorySeries below) — its per-occurrence
      // notes must stay reachable/erasable (issue #255), just not fetched for
      // every series the family has EVER had on every mount and every focus
      // refetch. allSettled isolates failures: one series' PERMISSION_DENIED
      // must render an inline per-card error, not flip the whole page to
      // loadError.
      const activeSeries = rows.filter((r) => r.type === 'recurring' && r.status === 'confirmed');
      const settled = await Promise.allSettled(
        activeSeries.map((s) =>
          fetchSeriesInstances(s.sessionId).then((instanceRows) => ({
            sessionId: s.sessionId,
            rows: instanceRows,
          })),
        ),
      );
      if (!mountedRef.current || runId !== runIdRef.current) return;
      // A successful (re)load clears any prior transient failure — a sticky
      // flag would render the error next to the freshly loaded list.
      setLoadError(false);
      const byId: Record<string, StudySessionInstanceDoc[]> = {};
      const failedIds: string[] = [];
      settled.forEach((result, i) => {
        const sessionId = activeSeries[i].sessionId;
        if (result.status === 'fulfilled') byId[sessionId] = result.value.rows;
        else failedIds.push(sessionId);
      });
      // Merge, don't replace: a refetch only refreshes what it itself queried
      // (the ACTIVE set). A TERMINAL series' lazily-loaded instances from a
      // prior expand must survive an unrelated focus refetch, not vanish.
      setInstancesBySeries((prev) => ({ ...prev, ...byId }));
      setSeriesInstanceStatus((prev) => {
        const next = { ...prev };
        for (const sessionId of Object.keys(byId)) delete next[sessionId];
        for (const sessionId of failedIds) next[sessionId] = 'error';
        return next;
      });
      setSessions(rows);
    } catch {
      // A THROW is a load failure — surface it honestly rather than
      // conflating it with the family having no sessions (the empty state).
      if (mountedRef.current && runId === runIdRef.current) setLoadError(true);
    }
  }, [familyId, fetchSeriesInstances]);

  useEffect(() => {
    load();
  }, [load]);

  // Issue #117 tier (a): a returning user re-runs the same load, so an open tab
  // doesn't show a stale sessions list.
  useRefetchOnFocus(load);

  // This family's submitted endorsements, to gate the post-completion prompt.
  // Equality-only (submittedByFamilyId + appSource) — no composite needed — and
  // we only need the tutor ids, so no sort. Mirrors the family RequestsPage query.
  // endorsedTutorsReady flips true on EITHER outcome (success or the
  // fallback-to-none-endorsed catch below) — it's the signal the
  // completed-series eager-instances effect waits on, so it never acts on the
  // still-empty INITIAL set.
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
        setEndorsedTutorsReady(true);
      })
      .catch(() => {
        // A denied/failed endorsements read must not block sessions — fall back to
        // "none endorsed" (the worst case is offering a prompt the callable then
        // rejects with already-exists, which the dialog handles gracefully). This
        // also means the completed-series eager-instances effect below treats
        // every tutor as unendorsed, so it eager-loads ALL completed series —
        // the same safe fallback, for the same reason.
        if (!cancelled) {
          setEndorsedTutors(new Set());
          setEndorsedTutorsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  // Issue #275 round 2: the endorse prompt sits on a completed recurring
  // series' history card header and is the family's main path into
  // endorsing — it must appear WITHOUT an expand click. So a COMPLETED
  // series whose tutor is NOT YET endorsed stays EAGER (bounded by "tutors
  // not yet endorsed", not "every series ever created" — still a real bound,
  // just a different one than the active-series bound in load()). A
  // completed series whose tutor IS already endorsed, and every
  // declined/cancelled series, stays LAZY on first history-card expand
  // exactly as toggleHistorySeries implements. Gated on endorsedTutorsReady
  // so this reads the real endorsed set rather than the still-empty initial
  // one (see the effect above for why a failed endorsements read still
  // behaves correctly here).
  //
  // Round 3 (review): this effect's deps include instancesBySeries and
  // seriesInstanceStatus, so it re-fires on every loadSeriesInstances
  // transition — loading, then success OR error. The condition below MUST
  // therefore exclude 'error' as well as 'loading': without it, a
  // persistently failing series (PERMISSION_DENIED, offline) re-passes the
  // guard on every re-fire (instancesBySeries[id] stays undefined forever)
  // and gets refetched every time, hammering Firestore. Excluding both
  // statuses makes each id get exactly ONE eager attempt; a further look is
  // only ever the card's manual retry button (loadSeriesInstances called
  // directly, bypassing this effect), matching load()'s no-auto-retry
  // contract for the active-series path.
  useEffect(() => {
    if (!sessions || !endorsedTutorsReady) return;
    for (const s of sessions) {
      if (
        s.type === 'recurring' &&
        s.status === 'completed' &&
        !endorsedTutors.has(s.tutorUserId) &&
        instancesBySeries[s.sessionId] === undefined &&
        seriesInstanceStatus[s.sessionId] !== 'loading' &&
        seriesInstanceStatus[s.sessionId] !== 'error'
      ) {
        loadSeriesInstances(s.sessionId);
      }
    }
  }, [
    sessions,
    endorsedTutorsReady,
    endorsedTutors,
    instancesBySeries,
    seriesInstanceStatus,
    loadSeriesInstances,
  ]);

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
    setMLocation((session.location as string) ?? 'online');
    setMMessage(session.message ?? '');
    setModifyError(null);
  };

  const submitModify = async () => {
    if (!modifyTarget) return;
    setModifySaving(true);
    setModifyError(null);
    try {
      const fn = httpsCallable(functions, 'modifySession');
      // Only EDITED fields go up: an untouched date/time must not run the
      // server's full when/where boundary against unchanged values
      // (PR #244 round 2).
      await fn({
        sessionId: modifyTarget.sessionId,
        ...(mDate !== (modifyTarget.date ?? '') ? { date: mDate } : {}),
        ...(mStart !== (modifyTarget.startTime ?? '') ? { startTime: mStart } : {}),
        ...(mLength !== (modifyTarget.sessionLengthMinutes ?? 60)
          ? { sessionLengthMinutes: mLength }
          : {}),
        ...(mLocation !== modifyTarget.location ? { location: mLocation } : {}),
        // '' is a real value -- it CLEARS a previously-set message. undefined
        // (field untouched and none existed) means "no change" server-side.
        message:
          mMessage.trim() === ''
            ? modifyTarget.message
              ? ''
              : undefined
            : mMessage.trim(),
      });
      setModifyTarget(null);
      void load();
    } catch (err) {
      const reason = (err as { details?: { reason?: string } })?.details?.reason;
      setModifyError(
        reason === 'time_unavailable'
          ? t('family.sessions.modifyTimeUnavailable')
          : reason === 'recurring_unsupported'
            ? t('family.sessions.modifyRecurringUnsupported')
            : reason === 'location_not_offered'
              ? t('family.sessions.modifyLocationUnavailable')
              : reason === 'length_not_offered'
                ? t('family.sessions.modifyLengthUnavailable')
                : reason === 'inside_notice_window'
                  ? t('family.sessions.modifyInsideNotice')
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
    remove: t('family.sessions.notes.remove'),
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
      patchLocalNote(session, instance, trimmed.length ? trimmed : undefined);
      setNoteTarget(null);
    } catch (err) {
      // A failed-precondition save is a dead-end, not a transient failure:
      // the window closed mid-edit (the session started, or it changed state
      // in another tab) and retrying can never work — say so instead of 'try
      // again' (issue #255 follow-up). The copy deliberately does NOT point
      // at the remove affordance: on a first-note save nothing is stored, so
      // no Remove button will render (PR #278 review). Clears never hit this
      // code (the erasure carve-out is status/timing-blind), so removeNote
      // keeps its erasure-specific copy.
      const code = (err as { code?: string })?.code ?? '';
      setNoteError(
        code.includes('failed-precondition')
          ? t('family.sessions.notes.errorClosed')
          : t('family.sessions.notes.error'),
      );
    } finally {
      setNoteSaving(false);
    }
  };

  /** Reflect a saved/cleared PRE-note in local state (non-optimistic: called
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
        { sessionId: string; instanceId?: string; kind: 'pre'; text: string },
        { success: boolean }
      >(functions, 'setSessionNote');
      await fn({
        sessionId: session.sessionId,
        ...(instance ? { instanceId: instance.instanceId } : {}),
        kind: 'pre',
        text: '',
      });
      patchLocalNote(session, instance, undefined);
      setNoteRemoveTarget(null);
    } catch {
      // Erasure-specific copy: the author's question here is "is the note
      // gone?" — "couldn't save" would answer the wrong one (round 4).
      setNoteError(t('family.sessions.notes.removeError'));
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

  // Expanding a TERMINAL series' history card is the lazy-load trigger (issue
  // #275): the first time it opens and its instances aren't already in
  // instancesBySeries (active-eager or a prior lazy load), fetch them.
  // Collapsing never unloads, and re-expanding an already-loaded series never
  // refetches.
  const toggleHistorySeries = (s: StudySessionDoc) => {
    const opening = !expanded.has(s.sessionId);
    toggleExpanded(s.sessionId);
    if (
      opening &&
      instancesBySeries[s.sessionId] === undefined &&
      seriesInstanceStatus[s.sessionId] !== 'loading'
    ) {
      loadSeriesInstances(s.sessionId);
    }
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

        {/* Isolated per-series failure (issue #275): this ACTIVE series'
            eager instance fetch rejected — the rest of the page (including
            other series) still rendered normally via allSettled in load(). */}
        {seriesInstanceStatus[s.sessionId] === 'error' && (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xs text-brand-600">{t('family.sessions.instancesLoadError')}</p>
            <Button
              size="sm"
              variant="outline"
              fullWidth={false}
              onClick={() => loadSeriesInstances(s.sessionId)}
            >
              {t('family.sessions.instancesRetry')}
            </Button>
          </div>
        )}

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
      <TopNav title={t('family.sessions.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {/* Skeletons sized like the loaded session cards, so the list keeps
            its footprint while loading (UX F12, issue #126) */}
        {sessions === null && !loadError && (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
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
                          {/* one_time only: a recurring parent would round-trip
                              to the server's recurring_unsupported refusal. */}
                          {s.type === 'one_time' && (
                            <Button
                              size="sm"
                              variant="outline"
                              fullWidth={false}
                              onClick={() => openModify(s)}
                            >
                              {t('family.sessions.modifySession')}
                            </Button>
                          )}
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
                    {/* Any settled one_time keeps its notes visible read-only
                        (not just completed): a cancelled session's note is
                        exactly the one its author must still be able to see
                        and REMOVE (issue #255 — mirrors sit's every-variant
                        rendering). The component self-nulls when empty. */}
                    {s.type === 'one_time' && (
                      <SessionNotes
                        pre={s.preSessionNote}
                        post={s.postSessionNote}
                        editKind="pre"
                        canEdit={false}
                        onEdit={() => {}}
                        onRemove={() => { setNoteError(null); setNoteRemoveTarget({ session: s }); }}
                        copy={noteCopy}
                      />
                    )}
                    {/* A terminal SERIES keeps its per-occurrence notes
                        reachable too (issue #255 round 1): each noted
                        occurrence renders read-only with the erasure
                        affordance — otherwise the notes strand the moment
                        the series completes or is cancelled, with no
                        redaction backstop in study. Its instances are loaded
                        LAZILY on first expand rather than eagerly for every
                        series the family has ever had (issue #275) — EXCEPT
                        a completed series whose tutor isn't endorsed yet,
                        which the effect above already eager-loaded so
                        hasCompletedWork/endorseButton (reading this same
                        instancesBySeries map) can show the endorse prompt
                        without an expand click. */}
                    {s.type === 'recurring' && (
                      <div className="mt-3">
                        <Button size="sm" variant="ghost" onClick={() => toggleHistorySeries(s)}>
                          {expanded.has(s.sessionId)
                            ? t('family.sessions.hideDates')
                            : t('family.sessions.viewDates')}
                        </Button>
                        {seriesInstanceStatus[s.sessionId] === 'loading' && (
                          <p className="mt-2 text-xs text-gray-500">
                            {t('family.sessions.instancesLoading')}
                          </p>
                        )}
                        {seriesInstanceStatus[s.sessionId] === 'error' && (
                          <div className="mt-2 flex items-center gap-2">
                            <p className="text-xs text-brand-600">
                              {t('family.sessions.instancesLoadError')}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              fullWidth={false}
                              onClick={() => loadSeriesInstances(s.sessionId)}
                            >
                              {t('family.sessions.instancesRetry')}
                            </Button>
                          </div>
                        )}
                        {expanded.has(s.sessionId) &&
                          seriesInstanceStatus[s.sessionId] !== 'loading' &&
                          seriesInstanceStatus[s.sessionId] !== 'error' &&
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
                                  editKind="pre"
                                  canEdit={false}
                                  onEdit={() => {}}
                                  onRemove={() => {
                                    setNoteError(null);
                                    setNoteRemoveTarget({ session: s, instance: i });
                                  }}
                                  copy={noteCopy}
                                />
                              </div>
                            ))}
                      </div>
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
      <Dialog open={acceptTarget !== null} onClose={() => setAcceptTarget(null)} ariaLabel={t('family.sessions.proposalAcceptTitle')}>
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
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)} ariaLabel={t('family.sessions.proposalDeclineTitle')}>
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

      {modifyTarget && (
        <Dialog open onClose={() => setModifyTarget(null)} ariaLabel={t('family.sessions.modifyTitle')}>
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
                <option key={l} value={l}>
                  {l} min
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-gray-700">
            {t('family.sessions.modifyLocation')}
            <select
              className="mt-1 h-11 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-3"
              value={mLocation}
              onChange={(e) => setMLocation(e.target.value)}
            >
              {['family_home', 'tutor_home', 'online', 'library'].map((l) => (
                <option key={l} value={l}>
                  {t(`family.sessions.location.${l}`)}
                </option>
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
      {/* ── Cancellation (reason required, ≥3 chars) ── */}
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
      {/* Remove-note confirmation (erasure path, issue #255) — shared Dialog,
          same error copy as the save path. onClose gated on noteSaving: the
          Dialog closes on backdrop click, and dismissing mid-flight would
          unmount the only thing that can render the error of a
          non-optimistic (erasure!) call. */}
      <Dialog open={noteRemoveTarget !== null} onClose={() => { if (!noteSaving) setNoteRemoveTarget(null); }} ariaLabel={t('family.sessions.notes.removeTitle')}>
        <h3 className="mb-2 text-lg font-bold">{t('family.sessions.notes.removeTitle')}</h3>
        <p className="mb-3 text-sm text-gray-600">{t('family.sessions.notes.removeDesc')}</p>
        {noteError && <p className="mb-3 text-sm text-brand-600">{noteError}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={noteSaving} onClick={removeNote}>
            {t('family.sessions.notes.removeConfirm')}
          </Button>
          <Button variant="ghost" className="flex-1" disabled={noteSaving} onClick={() => setNoteRemoveTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

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
