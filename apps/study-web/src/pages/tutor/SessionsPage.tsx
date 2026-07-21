import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot } from '@ejm/shared-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, Button, Badge, TopNav, Spinner, Dialog } from '@ejm/shared-ui';
import { RecurringConflictPreview } from '@/components/tutor/RecurringConflictPreview';
import type { StudySessionDoc, StudySessionInstanceDoc } from '@/types/studySession';

/** Shape of a recurring respondToSession result — drives the outcome dialog. */
interface RecurringResult {
  scheduledDates: string[];
  skippedDates: string[];
}

/** What the cancel modal is targeting. */
type CancelTarget =
  | { kind: 'session' | 'series'; session: StudySessionDoc }
  | { kind: 'instance'; session: StudySessionDoc; instance: StudySessionInstanceDoc };

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
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [instancesBySeries, setInstancesBySeries] = useState<
    Record<string, StudySessionInstanceDoc[]>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<StudySessionDoc | null>(null);
  const [recurringResult, setRecurringResult] = useState<RecurringResult | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Key of the row awaiting the respond callable (a session id).
  const [actingId, setActingId] = useState<string | null>(null);
  // Key of the row awaiting a cancel callable (session id, or `sid::instanceId`).
  const [cancelKey, setCancelKey] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid)),
        );
        if (cancelled) return;
        const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));

        // Load the instance subcollections for confirmed recurring series via the
        // nested path (own-uid reads; rules permit).
        const series = rows.filter((r) => r.status === 'confirmed' && r.type === 'recurring');
        const instanceLists = await Promise.all(
          series.map((s) =>
            getDocs(collection(db, 'study-sessions', s.sessionId, 'instances')).then((isnap) => ({
              sessionId: s.sessionId,
              rows: isnap.docs.map((d) => d.data() as StudySessionInstanceDoc),
            })),
          ),
        );
        if (cancelled) return;
        const byId: Record<string, StudySessionInstanceDoc[]> = {};
        for (const { sessionId, rows: irows } of instanceLists) byId[sessionId] = irows;
        setInstancesBySeries(byId);
        setSessions(rows);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

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
      setSessions((rs) =>
        (rs ?? []).map((s) => (s.sessionId === session.sessionId ? { ...s, status: next } : s)),
      );
      if (action === 'confirm' && session.type === 'recurring' && res.data.scheduledDates) {
        setRecurringResult({
          scheduledDates: res.data.scheduledDates,
          skippedDates: res.data.skippedDates ?? [],
        });
      }
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

  const openCancel = (target: CancelTarget) => {
    setCancelReason('');
    setCancelError(null);
    setCancelTarget(target);
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
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
      setCancelReason('');
    } catch {
      setCancelError(t('tutor.sessions.actionError'));
    } finally {
      setCancelKey(null);
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

  function renderOneTimeUpcoming(s: StudySessionDoc) {
    return (
      <Card key={s.sessionId}>
        <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
        <p className="text-xs text-gray-500">
          {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
        </p>
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(s.date)} · {s.startTime}
          {s.endTime ? `–${s.endTime}` : ''}
        </p>
        <p className="text-xs text-gray-500">{t(`tutor.sessions.location.${s.location}`)}</p>
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
      </Card>
    );
  }

  function instanceChip(i: StudySessionInstanceDoc): string | null {
    if (i.status === 'completed') return t('tutor.sessions.instanceStatus.completed');
    if (i.status === 'cancelled')
      return i.statusReason === 'conflict_skip'
        ? t('tutor.sessions.instanceStatus.skipped')
        : t('tutor.sessions.instanceStatus.cancelled');
    return null; // scheduled
  }

  function renderSeries(s: StudySessionDoc, instances: StudySessionInstanceDoc[]) {
    const isOpen = expanded.has(s.sessionId);
    const sorted = [...instances].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
          <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
            {sorted.length === 0 && (
              <li className="text-xs text-gray-400">{t('tutor.sessions.noOccurrences')}</li>
            )}
            {sorted.map((i) => {
              const chip = instanceChip(i);
              const cancelable = i.status === 'scheduled' && i.date >= today;
              const key = `${s.sessionId}::${i.instanceId}`;
              return (
                <li key={i.instanceId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-700">
                    {formatDateStr(i.date)} · {i.startTime}–{i.endTime}
                  </span>
                  <span className="flex items-center gap-2">
                    {chip && <Badge variant="gray">{chip}</Badge>}
                    {cancelable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelKey === key}
                        onClick={() => openCancel({ kind: 'instance', session: s, instance: i })}
                      >
                        {t('tutor.sessions.cancelInstance')}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <div>
      <TopNav title={t('tutor.sessionsTitle')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {sessions === null && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
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
                    {s.students.map((st) => `${st.firstName} (${st.age})`).join(', ')}
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
                          {s.schoolWeeksOnly && (
                            <Badge variant="gray">{t('tutor.sessions.schoolWeeksOnly')}</Badge>
                          )}
                          {s.endDate && (
                            <span className="text-gray-500">
                              {t('tutor.sessions.until', { date: formatDateStr(s.endDate) })}
                            </span>
                          )}
                        </div>
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
                    <Badge variant="gray">{t(`tutor.sessions.status.${s.status}`)}</Badge>
                  </div>
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
      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">
          {cancelTarget?.kind === 'series'
            ? t('tutor.sessions.cancelSeriesTitle')
            : cancelTarget?.kind === 'instance'
              ? t('tutor.sessions.cancelInstanceTitle')
              : t('tutor.sessions.cancelTitle')}
        </h3>
        <p className="mb-3 text-sm text-gray-600">{t('tutor.sessions.cancelDesc')}</p>
        <textarea
          className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm"
          rows={3}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('tutor.sessions.cancelReasonPlaceholder')}
        />
        {cancelError && <p className="mb-3 text-sm text-red-600">{cancelError}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={cancelReason.trim().length < 3 || cancelKey !== null}
            onClick={submitCancel}
          >
            {t('tutor.sessions.cancelConfirm')}
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            disabled={cancelKey !== null}
            onClick={() => setCancelTarget(null)}
          >
            {t('tutor.sessions.cancelKeep')}
          </Button>
        </div>
      </Dialog>

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
