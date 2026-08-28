import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { StudyContactRequestDoc, StudyContactRequestStatus } from '@ejm/study-core';
import {
  Card,
  Button,
  Badge,
  TopNav,
  SkeletonCard,
  Dialog,
  useToast,
  EmptyState,
  UsersIcon,
} from '@ejm/shared-ui';

/**
 * Tutor inbox for incoming family contact requests. Reads
 * `studyContactRequests` where `tutorUserId == me`.
 *
 * INDEX NOTE: the only studyContactRequests composite keyed on tutorUserId is
 * (tutorUserId, status, createdAt). That index cannot serve a
 * `where(tutorUserId ==) + orderBy(createdAt)` query (status sits between the
 * two), so rather than add an index in this PR we query by tutorUserId alone
 * (single-field, always indexed) and sort newest-first CLIENT-SIDE.
 *
 * Pending requests get Accept / Decline actions (decline is confirmed — it
 * blocks that family for 7 days). Responses are optimistic with rollback +
 * an error message if the callable fails.
 */
const STATUS_VARIANT: Record<StudyContactRequestStatus, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  accepted: 'green',
  declined: 'gray',
  // A family can withdraw its request while pending; it then lands in history.
  cancelled: 'gray',
};

export function RequestsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  // The subscription errored (e.g. PERMISSION_DENIED) — surfaced honestly, never
  // conflated with the empty state.
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<StudyContactRequestDoc | null>(null);
  // requestId currently awaiting the callable, or null. A row is "in flight"
  // while its id is here — its actions are disabled and its status is NOT yet
  // changed (see respond).
  const [actingId, setActingId] = useState<string | null>(null);
  // The request whose withdraw-confirmation dialog is open, or null. Withdraw
  // is not recoverable by re-clicking -- it emails and pushes every parent of
  // the family -- so it confirms, like the family's Cancel and like a
  // guardian withdrawing on the kid's behalf (PR #213 review).
  const [withdrawTarget, setWithdrawTarget] = useState<StudyContactRequestDoc | null>(null);

  // Live subscription (issue #117 tier b): the same provable equality query as
  // before, but every snapshot re-renders the inbox — a tutor with an open tab
  // sees a new request without reloading. First snapshot resolves the loading
  // state; the error callback surfaces a load failure.
  useEffect(() => {
    if (!uid) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'studyContactRequests'), where('tutorUserId', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as StudyContactRequestDoc);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setLoadError(false);
        setRequests(rows);
      },
      () => setLoadError(true),
    );
    return unsubscribe;
  }, [uid]);

  const formatDate = (ts: StudyContactRequestDoc['createdAt']): string => {
    const raw: unknown = ts;
    // Emulator-written rows can arrive as a plain Date; production Firestore
    // returns a Timestamp with .toDate(). Handle both, then fall back to ''
    // (mirrors the family RequestsPage).
    const date =
      raw instanceof Date
        ? raw
        : raw && typeof (raw as { toDate?: unknown }).toDate === 'function'
          ? (raw as { toDate: () => Date }).toDate()
          : null;
    if (!date) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const respond = async (req: StudyContactRequestDoc, action: 'accept' | 'decline') => {
    // NON-OPTIMISTIC: accepted-state is consent, so we must never display it
    // before the backend confirms. Mark the row in-flight, and apply the status
    // change ONLY after the callable resolves; on failure the row stays pending
    // and re-enables. (A crashed/never-settling worker leaves the row pending,
    // matching Firestore — no phantom "accepted".)
    const next: StudyContactRequestStatus = action === 'accept' ? 'accepted' : 'declined';
    setError(null);
    setActingId(req.requestId);
    try {
      const fn = httpsCallable(functions, 'respondToTutorContactRequest');
      await fn({ requestId: req.requestId, action });
      setRequests((rs) =>
        (rs ?? []).map((r) => (r.requestId === req.requestId ? { ...r, status: next } : r)),
      );
      toast(t(`tutor.requests.status.${next}`));
    } catch {
      setError(t('tutor.requests.actionError'));
    } finally {
      setActingId(null);
    }
  };

  // Withdrawing this tutor's OWN approach (issue #207 PR4). Same
  // non-optimistic discipline: the backend owns the transition, and until it
  // resolves the row stays pending. Without this lever a request the family
  // never answers would block the pair from ever contacting each other again
  // -- the pending guard is symmetric, so it locks both directions.
  const withdraw = async (req: StudyContactRequestDoc) => {
    setError(null);
    setActingId(req.requestId);
    try {
      const fn = httpsCallable(functions, 'cancelContactRequest');
      await fn({ requestId: req.requestId });
      setRequests((rs) =>
        (rs ?? []).map((r) => (r.requestId === req.requestId ? { ...r, status: 'cancelled' } : r)),
      );
      toast(t('tutor.requests.status.cancelled'));
    } catch {
      setError(t('tutor.requests.actionError'));
    } finally {
      setActingId(null);
    }
  };

  // Pending splits by WHO opened it (issue #207 PR4): only a family-initiated
  // request is awaiting THIS tutor. One this tutor opened by answering a
  // published search is waiting on the family, and grouping it under
  // "Awaiting your response" would read as a to-do that has no action.
  const pending = (requests ?? []).filter(
    (r) => r.status === 'pending' && r.initiatedBy !== 'tutor',
  );
  const outgoing = (requests ?? []).filter(
    (r) => r.status === 'pending' && r.initiatedBy === 'tutor',
  );
  const history = (requests ?? []).filter((r) => r.status !== 'pending');

  return (
    <div>
      <TopNav title={t('tutor.requests.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {loadError && (
          <p className="py-10 text-center text-sm text-red-600">{t('tutor.requests.loadError')}</p>
        )}

        {/* Skeletons sized like the loaded request cards, so the list keeps
            its footprint while loading (UX F12, issue #126) */}
        {!loadError && requests === null && (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loadError && requests !== null && requests.length === 0 && (
          <Card>
            <EmptyState
              icon={<UsersIcon className="h-6 w-6" />}
              message={t('tutor.requests.empty')}
              actionLabel={t('tutor.requests.emptyAction')}
              actionTo="/tutor/subjects"
            />
          </Card>
        )}

        {/* ── Pending (actionable) ── */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.requests.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pending.map((r) => (
                <Card key={r.requestId}>
                  <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                  <p className="text-xs text-gray-500">{r.parentName}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                  </p>
                  {r.message && (
                    <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                      {r.message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {t('tutor.requests.sentOn', { date: formatDate(r.createdAt) })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={actingId === r.requestId}
                      onClick={() => respond(r, 'accept')}
                    >
                      {t('tutor.requests.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === r.requestId}
                      onClick={() => setDeclineTarget(r)}
                    >
                      {t('tutor.requests.decline')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Sent by this tutor, waiting on the family (issue #207 PR4) ──
            Deliberately its OWN section: these carry no action for the tutor,
            and answering one would be the tutor approving their own contact
            (the server refuses it as well). */}
        {outgoing.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.requests.outgoingTitle')}
            </h2>
            <div className="space-y-3">
              {outgoing.map((r) => (
                <Card key={r.requestId}>
                  <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                  </p>
                  {r.message && (
                    <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                      {r.message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {t('tutor.requests.sentOn', { date: formatDate(r.createdAt) })}
                  </p>
                  <p className="mt-3 text-xs text-gray-500">
                    {t('tutor.requests.awaitingFamily')}
                  </p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === r.requestId}
                      onClick={() => setWithdrawTarget(r)}
                    >
                      {t('tutor.requests.withdraw')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── History (read-only) ── */}
        {history.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.requests.historyTitle')}
            </h2>
            <div className="space-y-3">
              {history.map((r) => (
                <Card key={r.requestId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                      <p className="text-xs text-gray-500">
                        {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t('tutor.requests.sentOn', { date: formatDate(r.createdAt) })}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {t(`tutor.requests.status.${r.status}`)}
                    </Badge>
                  </div>
                  {/* An accepted request unlocks tutor-initiated proposals. */}
                  {r.status === 'accepted' && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(`/tutor/propose/${r.familyId}`, {
                            state: {
                              familyName: r.familyName,
                              subject: r.subject,
                              level: r.level,
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

      {/* ── Decline confirmation ── */}
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)} ariaLabel={t('tutor.requests.confirmDeclineTitle')}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.requests.confirmDeclineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('tutor.requests.confirmDeclineDesc')}</p>
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
            {t('tutor.requests.confirmDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={withdrawTarget !== null} onClose={() => setWithdrawTarget(null)} ariaLabel={t('tutor.requests.confirmWithdrawTitle')}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.requests.confirmWithdrawTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('tutor.requests.confirmWithdrawDesc')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={actingId !== null}
            onClick={() => {
              const target = withdrawTarget;
              setWithdrawTarget(null);
              if (target) withdraw(target);
            }}
          >
            {t('tutor.requests.confirmWithdrawCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setWithdrawTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
