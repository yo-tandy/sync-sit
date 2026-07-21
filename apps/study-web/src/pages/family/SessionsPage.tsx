import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot } from '@ejm/shared-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import { Card, Button, Badge, TopNav, Spinner } from '@ejm/shared-ui';
import { ReasonModal } from '@/components/sessions/ReasonModal';
import { SessionInstanceList } from '@/components/sessions/SessionInstanceList';
import type { StudySessionDoc, StudySessionInstanceDoc } from '@/types/studySession';

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

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [instancesBySeries, setInstancesBySeries] = useState<
    Record<string, StudySessionInstanceDoc[]>
  >({});
  const [loadError, setLoadError] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Key of the row awaiting a cancel callable (session id, or `sid::instanceId`).
  const [cancelKey, setCancelKey] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'study-sessions'), where('familyId', '==', familyId)),
        );
        if (cancelled) return;
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
        if (cancelled) return;
        const byId: Record<string, StudySessionInstanceDoc[]> = {};
        for (const { sessionId, rows: irows } of instanceLists) byId[sessionId] = irows;
        setInstancesBySeries(byId);
        setSessions(rows);
      } catch {
        // A THROW is a load failure — surface it honestly rather than
        // conflating it with the family having no sessions (the empty state).
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId]);

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
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={cancelKey === s.sessionId}
            onClick={() => openCancel({ kind: 'session', session: s })}
          >
            {t('family.sessions.cancelSession')}
          </Button>
        </div>
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
            }}
          />
        )}
      </Card>
    );
  }

  return (
    <div>
      <TopNav title={t('family.sessions.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {sessions === null && !loadError && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {loadError && (
          <p className="py-10 text-center text-sm text-red-600">
            {t('family.sessions.loadError')}
          </p>
        )}

        {sessions !== null &&
          pending.length === 0 &&
          upcomingEntries.length === 0 &&
          history.length === 0 && (
            <Card>
              <p className="py-4 text-center text-sm text-gray-500">
                {t('family.sessions.empty')}
              </p>
            </Card>
          )}

        {/* ── Pending (awaiting the tutor) ── */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.sessions.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pending.map((s) => (
                <Card key={s.sessionId}>
                  {sessionHeader(s)}
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
                  <p className="mt-1 text-xs text-amber-700">{t('family.sessions.awaitingTutor')}</p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelKey === s.sessionId}
                      onClick={() => openCancel({ kind: 'session', session: s })}
                    >
                      {t('family.sessions.cancelRequest')}
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
              {history.map((s) => (
                <Card key={s.sessionId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{s.tutorName}</p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${s.subject}`)} · {s.level}
                      </p>
                    </div>
                    <Badge variant="gray">{t(`family.sessions.status.${s.status}`)}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

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
        onConfirm={submitCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
