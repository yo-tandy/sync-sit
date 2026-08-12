import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { TutorEndorsementDoc } from '@ejm/study-core';
import { Card, Button, TopNav, Spinner, Dialog } from '@ejm/shared-ui';

/**
 * Tutor moderation inbox for family-submitted endorsements. Reads the shared
 * `references` collection where `tutorUserId == me`.
 *
 * INDEX NOTE: unlike studyContactRequests, references HAS a
 * (tutorUserId, createdAt desc) composite (shipped in #83), so we order
 * newest-first in the query rather than client-side. Sit references are keyed by
 * `babysitterUserId`, so `where(tutorUserId ==)` naturally excludes them.
 *
 * Pending endorsements (status 'private') get Accept / Dismiss actions — accept
 * publishes to the tutor's search profile, dismiss permanently removes it (hence
 * the confirm dialog). Responses are NON-OPTIMISTIC: the status change is applied
 * only after the callable resolves (mirrors the tutor RequestsPage). 'removed'
 * docs are hidden entirely.
 */
export function EndorsementsPage() {
  const { t, i18n } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [endorsements, setEndorsements] = useState<TutorEndorsementDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<TutorEndorsementDoc | null>(null);
  // referenceId currently awaiting the callable, or null. A row is "in flight"
  // while its id is here — its actions are disabled and its status is NOT yet
  // changed (see respond).
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'references'),
        where('tutorUserId', '==', uid),
        orderBy('createdAt', 'desc'),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        setEndorsements(snap.docs.map((d) => d.data() as TutorEndorsementDoc));
      })
      .catch(() => {
        if (!cancelled) setEndorsements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const formatDate = (ts: TutorEndorsementDoc['createdAt']): string => {
    const raw: unknown = ts;
    // Emulator-written rows can arrive as a plain Date; production Firestore
    // returns a Timestamp with .toDate(). Handle both, then fall back to ''
    // (mirrors the tutor RequestsPage).
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

  const respond = async (e: TutorEndorsementDoc, action: 'accept' | 'dismiss') => {
    // NON-OPTIMISTIC: publishing an endorsement is consent, so we never display
    // the new status before the backend confirms. Mark the row in-flight and
    // apply the change ONLY after the callable resolves; on failure the row
    // stays pending and re-enables. accept -> 'approved' (moves to Published),
    // dismiss -> 'removed' (hidden entirely).
    const next: TutorEndorsementDoc['status'] = action === 'accept' ? 'approved' : 'removed';
    setError(null);
    setActingId(e.referenceId);
    try {
      const fn = httpsCallable(functions, 'respondToTutorEndorsement');
      await fn({ referenceId: e.referenceId, action });
      setEndorsements((es) =>
        (es ?? []).map((r) => (r.referenceId === e.referenceId ? { ...r, status: next } : r)),
      );
    } catch {
      setError(t('tutor.endorsements.actionError'));
    } finally {
      setActingId(null);
    }
  };

  const all = endorsements ?? [];
  const pending = all.filter((e) => e.status === 'private');
  const published = all.filter((e) => e.status === 'approved' || e.status === 'published');
  const hasVisible = pending.length > 0 || published.length > 0;

  const submitter = (e: TutorEndorsementDoc): string =>
    e.submittedByName || e.refName || t('tutor.endorsements.anonymous');

  return (
    <div>
      <TopNav title={t('tutor.endorsements.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {endorsements === null && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {endorsements !== null && !hasVisible && (
          <Card>
            <p className="py-4 text-center text-sm text-gray-500">
              {t('tutor.endorsements.empty')}
            </p>
          </Card>
        )}

        {/* ── Pending (actionable) ── */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-1 text-sm font-semibold text-gray-700">
              {t('tutor.endorsements.pendingTitle')}
            </h2>
            <p className="mb-2 text-xs text-gray-500">{t('tutor.endorsements.pendingHint')}</p>
            <div className="space-y-3">
              {pending.map((e) => (
                <Card key={e.referenceId}>
                  <p className="text-sm text-gray-800">{e.referenceText}</p>
                  <p className="mt-2 text-xs font-semibold text-gray-700">{submitter(e)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {e.subject && `${t(`tutor.subjects.names.${e.subject}`)} · `}
                    {t('tutor.endorsements.submittedOn', { date: formatDate(e.createdAt) })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={actingId === e.referenceId}
                      onClick={() => respond(e, 'accept')}
                    >
                      {t('tutor.endorsements.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actingId === e.referenceId}
                      onClick={() => setDismissTarget(e)}
                    >
                      {t('tutor.endorsements.dismiss')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Published (read-only) ── */}
        {published.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('tutor.endorsements.publishedTitle')}
            </h2>
            <div className="space-y-3">
              {published.map((e) => (
                <Card key={e.referenceId}>
                  <p className="text-sm text-gray-800">{e.referenceText}</p>
                  <p className="mt-2 text-xs font-semibold text-gray-700">{submitter(e)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {e.subject && `${t(`tutor.subjects.names.${e.subject}`)} · `}
                    {t('tutor.endorsements.submittedOn', { date: formatDate(e.createdAt) })}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Dismiss confirmation (permanent) ── */}
      <Dialog open={dismissTarget !== null} onClose={() => setDismissTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.endorsements.confirmDismissTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('tutor.endorsements.confirmDismissDesc')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={actingId !== null}
            onClick={() => {
              const target = dismissTarget;
              setDismissTarget(null);
              if (target) respond(target, 'dismiss');
            }}
          >
            {t('tutor.endorsements.confirmDismissCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDismissTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
