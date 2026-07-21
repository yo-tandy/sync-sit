import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RecurringSlot } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, Button, Badge, TopNav, Spinner, Dialog } from '@ejm/shared-ui';
import { RecurringConflictPreview } from '@/components/tutor/RecurringConflictPreview';

/**
 * Client-facing shape of a `study-sessions/{sessionId}` document — the subset
 * the tutor UI reads. The authoritative type lives in study-functions
 * (SessionDoc); this app cannot import across the function boundary, so we
 * mirror only the fields we render. Exported so the conflict-preview component
 * and later session tasks share it.
 */
export interface StudySessionDoc {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  subject: string;
  level: string;
  rate: number;
  students: { firstName: string; age: number }[];
  familyName: string;
  parentName: string;
  tutorName: string;
  type: 'one_time' | 'recurring';
  date?: string;
  startTime: string;
  endTime?: string;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;
  endDate?: string;
  location: LocationPref;
  message?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed';
  statusReason?: string;
  createdAt?: { seconds?: number } | null;
}

/** Shape of a recurring respondToSession result — drives the outcome dialog. */
interface RecurringResult {
  scheduledDates: string[];
  skippedDates: string[];
}

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

/**
 * Tutor sessions hub. Reads `study-sessions` where `tutorUserId == me` and
 * shows the pending inbox with accept/decline. (Upcoming + history land in a
 * later task.)
 *
 * INDEX NOTE: the only study-sessions composite keyed on tutorUserId is
 * (tutorUserId, status, date). That index cannot serve a
 * `where(tutorUserId ==) + orderBy(createdAt)` query, so — exactly like the
 * tutor RequestsPage — we query by tutorUserId alone (single-field, always
 * indexed) and sort newest-first CLIENT-SIDE.
 *
 * Responses are NON-OPTIMISTIC: a confirmed session is a commitment, so the row
 * only changes state after respondToSession resolves. A recurring confirm
 * returns which candidate dates were scheduled vs. skipped (conflicts/holidays
 * are dropped automatically by the callable), surfaced in a result dialog.
 */
export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [sessions, setSessions] = useState<StudySessionDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<StudySessionDoc | null>(null);
  const [recurringResult, setRecurringResult] = useState<RecurringResult | null>(null);
  // sessionId currently awaiting the callable, or null. A row is "in flight"
  // while its id is here — its actions are disabled and its status is NOT yet
  // changed (see respond).
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDocs(query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid)))
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs.map((d) => d.data() as StudySessionDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Format a "YYYY-MM-DD" session date. Parsed field-by-field (not `new
  // Date(str)`, which reads as UTC midnight and can slip a day in negative
  // offsets) so the label matches the tutor's local calendar date.
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
    // NON-OPTIMISTIC: a confirmed session is a commitment, so we never display
    // the resolved state before the backend confirms. Mark the row in-flight and
    // apply the status change ONLY after the callable resolves; on failure the
    // row stays pending and re-enables.
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
      // A recurring confirm reports which candidate dates were scheduled vs
      // skipped — surface it so the tutor sees what actually landed.
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

  // Map callable errors by CODE, not by message. The backend raises the same
  // `failed-precondition` for every "can't claim this slot now" case (slot just
  // taken, too close to the session, already resolved), so we map the code to
  // ONE generic message that quotes none of them.
  const mapRespondError = (e: unknown): string => {
    const code = (e as { code?: string })?.code ?? '';
    if (code.includes('failed-precondition')) return t('tutor.sessions.errorCannotConfirm');
    if (code.includes('permission-denied')) return t('tutor.sessions.errorPermission');
    if (code.includes('not-found')) return t('tutor.sessions.errorNotFound');
    return t('tutor.sessions.actionError');
  };

  const pending = (sessions ?? []).filter((s) => s.status === 'pending');

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

        {sessions !== null && pending.length === 0 && (
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
                        {s.recurringSlots?.[0] && (
                          <p>
                            {t('tutor.sessions.recurringSlot', {
                              day: t(`days.${DAY_FULL[s.recurringSlots[0].day]}`),
                              start: s.recurringSlots[0].startTime,
                              end: s.recurringSlots[0].endTime,
                            })}
                          </p>
                        )}
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
                      {t(`tutor.sessions.location.${s.location}`)} · {t('tutor.sessions.rate', { rate: s.rate })}
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
      </div>

      {/* ── Decline confirmation (no reason needed — a decline, unlike a
          cancellation, carries none) ── */}
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

      {/* ── Recurring confirm result ── */}
      <Dialog open={recurringResult !== null} onClose={() => setRecurringResult(null)}>
        {recurringResult && (
          <>
            <h3 className="mb-2 text-lg font-bold">{t('tutor.sessions.result.title')}</h3>
            <p className="mb-3 text-sm text-gray-600">
              {t('tutor.sessions.result.summary', {
                scheduled: recurringResult.scheduledDates.length,
                total:
                  recurringResult.scheduledDates.length + recurringResult.skippedDates.length,
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
