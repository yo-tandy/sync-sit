import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { isTaskCategory, type DoerEndorsementDoc } from '@ejm/do-core';
import { Button, Card, Dialog, EmptyState, Spinner, UsersIcon } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatEndorsementDate } from '@/lib/endorsementDisplay';

/**
 * "My endorsements" (plan §9.2, decision 12 as revised) — the doer's own
 * management surface, mirroring study's tutor `EndorsementsPage`: pending
 * endorsements from families to accept or decline, then the accepted set as
 * it renders on offer cards.
 *
 * QUERY: `where('doerUserId','==',uid)` ordered `createdAt desc` — ONE
 * query, no status filter. It is provable ONLY through the `references`
 * read rule's `doerUserId` recipient disjunct (plan §12's second amendment,
 * issue #300, landed with this surface); before that amendment every
 * `private` row — which is exactly the pending list — was
 * `PERMISSION_DENIED`. Served by the `(doerUserId, createdAt DESC)`
 * composite. `where(doerUserId ==)` naturally excludes sit references and
 * study endorsements, which carry different key fields.
 *
 * `getDocs`, not `onSnapshot`: the only writer is the doer themselves,
 * through a callable whose result this page applies locally. A live
 * subscription would re-render for nothing and hold a listener open on a
 * collection the doer has no other reason to watch (study's precedent).
 *
 * RESPONSES ARE NON-OPTIMISTIC (the study precedent, and the reason is
 * consent): publishing family-authored text about yourself is a decision,
 * so the row's status changes only once the callable resolves. On failure
 * the row stays pending and re-enables.
 *
 * SHAPE FILTER — defence in depth (PR #352 round-1 review). The query is
 * deliberately status-unfiltered, so whatever a `doerUserId == me` read
 * returns lands on this page. PR #352 tightened the `references` CREATE
 * rule so a client can no longer smuggle a foreign `doerUserId` onto a
 * manual reference of their own, which is the root fix — but a doc forged
 * BEFORE that rule shipped is still in the collection, and this page is the
 * one surface that would render it with attacker-controlled text and
 * attribution. So the page narrows to exactly what
 * `doRespondToEndorsement` will act on (`appSource === 'do'` and
 * `type === 'family_submitted'`): anything else could only ever render as a
 * row whose buttons the server refuses, which is worse than not rendering
 * it at all.
 */
export function MyEndorsementsPage() {
  const { t, i18n } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [endorsements, setEndorsements] = useState<DoerEndorsementDoc[] | null>(null);
  // A failed read must never render as the reassuring empty state — the
  // TaskDetailPage rule (PR #331 round 2): "no endorsements yet" would be an
  // affirmative false statement. Its own error + retry instead.
  const [loadError, setLoadError] = useState(false);
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<DoerEndorsementDoc | null>(null);
  /** referenceId awaiting the callable — its row's actions are disabled. */
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'references'),
        where('doerUserId', '==', uid),
        orderBy('createdAt', 'desc'),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        setEndorsements(snap.docs.map((d) => d.data() as DoerEndorsementDoc));
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, tick]);

  const respond = async (e: DoerEndorsementDoc, action: 'accept' | 'decline') => {
    const next: DoerEndorsementDoc['status'] = action === 'accept' ? 'approved' : 'removed';
    setActionError(false);
    setActingId(e.referenceId);
    try {
      await httpsCallable(functions, 'doRespondToEndorsement')({
        referenceId: e.referenceId,
        action,
      });
      setEndorsements((all) =>
        (all ?? []).map((r) => (r.referenceId === e.referenceId ? { ...r, status: next } : r)),
      );
    } catch {
      setActionError(true);
    } finally {
      setActingId(null);
    }
  };

  if (loadError) {
    return (
      <div className="px-6 pt-4 pb-8">
        <h1 className="mb-4 text-xl font-bold text-gray-950">{t('doer.endorsements.title')}</h1>
        <div className="py-6 text-center">
          <p className="mb-3 text-sm text-error-600">{t('doer.endorsements.loadError')}</p>
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            onClick={() => {
              // Clear the error so the retry falls through to the spinner —
              // otherwise a re-failed read changes nothing and the button
              // reads as dead (the AssignedTaskView retry idiom).
              setLoadError(false);
              setEndorsements(null);
              setTick((n) => n + 1);
            }}
          >
            {t('doer.endorsements.retry')}
          </Button>
        </div>
      </div>
    );
  }
  if (endorsements === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  // Only rows this surface can actually act on — see SHAPE FILTER above.
  const actionable = endorsements.filter(
    (e) => e.appSource === 'do' && e.type === 'family_submitted',
  );
  const pending = actionable.filter((e) => e.status === 'private');
  // What the offer card shows, shown here in the same set: approved and
  // published. `removed` rows are hidden entirely — a declined endorsement
  // is gone, not archived (study's rule).
  const publishedSet = actionable.filter(
    (e) => e.status === 'approved' || e.status === 'published',
  );

  const submitter = (e: DoerEndorsementDoc): string =>
    e.submittedByName || e.refName || t('doer.endorsements.anonymous');

  // `category` is server-copied from the qualifying task, so it is always a
  // real §4.3 key on a doc this app wrote — but an unknown value would print
  // raw as "categories.foo", so it is checked against the taxonomy rather
  // than trusted (PR #352 round-1 review).
  const meta = (e: DoerEndorsementDoc) =>
    [
      e.category && isTaskCategory(e.category) ? t(`categories.${e.category}`) : null,
      formatEndorsementDate(e.createdAt, i18n.language),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="px-6 pt-4 pb-8">
      <h1 className="mb-1 text-xl font-bold text-gray-950">{t('doer.endorsements.title')}</h1>
      <p className="mb-4 text-xs text-gray-500">{t('doer.endorsements.intro')}</p>

      {actionError && <p className="mb-3 text-sm text-error-600">{t('doer.endorsements.actionError')}</p>}

      {pending.length === 0 && publishedSet.length === 0 && (
        <EmptyState icon={<UsersIcon className="h-6 w-6" />} message={t('doer.endorsements.empty')} />
      )}

      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">
            {t('doer.endorsements.pendingTitle')}
          </h2>
          <p className="mb-2 text-xs text-gray-500">{t('doer.endorsements.pendingHint')}</p>
          {pending.map((e) => (
            <Card key={e.referenceId} className="mb-3">
              <p className="text-sm whitespace-pre-wrap text-gray-800">{e.referenceText}</p>
              <p className="mt-2 text-xs font-semibold text-gray-700">{submitter(e)}</p>
              <p className="mt-0.5 text-xs text-gray-500">{meta(e)}</p>
              <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={actingId === e.referenceId}
                  onClick={() => respond(e, 'accept')}
                >
                  {t('doer.endorsements.accept')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={actingId === e.referenceId}
                  onClick={() => {
                    setActionError(false);
                    setDeclineTarget(e);
                  }}
                >
                  {t('doer.endorsements.decline')}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {publishedSet.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-700">
            {t('doer.endorsements.publishedTitle')}
          </h2>
          <p className="mb-2 text-xs text-gray-500">{t('doer.endorsements.publishedHint')}</p>
          {publishedSet.map((e) => (
            <Card key={e.referenceId} className="mb-3">
              <p className="text-sm whitespace-pre-wrap text-gray-800">{e.referenceText}</p>
              <p className="mt-2 text-xs font-semibold text-gray-700">{submitter(e)}</p>
              <p className="mt-0.5 text-xs text-gray-500">{meta(e)}</p>
            </Card>
          ))}
        </section>
      )}

      {/* Declining is permanent — the doc goes to `removed` and nothing
          brings it back, so it gets a confirm (study's dismiss precedent). */}
      {declineTarget && (
        <Dialog
          open
          onClose={() => setDeclineTarget(null)}
          ariaLabel={t('doer.endorsements.declineConfirmTitle')}
        >
          <h3 className="mb-2 text-lg font-bold">{t('doer.endorsements.declineConfirmTitle')}</h3>
          <p className="mb-5 text-sm text-gray-600">{t('doer.endorsements.declineConfirmBody')}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={actingId !== null}
              onClick={() => {
                // Close BEFORE dispatching: a refusal's copy must render on
                // the page, never behind an aria-modal scrim where it is
                // invisible and unannounced (the do-web house rule).
                const target = declineTarget;
                setDeclineTarget(null);
                void respond(target, 'decline');
              }}
            >
              {t('doer.endorsements.declineConfirmCta')}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
              {t('common.back')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
