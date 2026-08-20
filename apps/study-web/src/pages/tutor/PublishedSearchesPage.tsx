import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Badge, Button, Card, Dialog, Textarea, TopNav, EmptyState, SearchIcon } from '@ejm/shared-ui';
import type { BoardSearch } from '@/components/published/usePublishedSearches';
import { usePublishedSearches } from '@/components/published/usePublishedSearches';
import { PublishedSearchCard } from '@/components/published/PublishedSearchCard';

/**
 * Published-searches board for tutors (issue #207). Lists every ACTIVE study
 * published search — deliberately unfiltered by the tutor's own subjects or
 * searchable flag (the board's whole point) — newest first.
 *
 * "New" tagging: a doc is New iff createdAt > the tutor's stored
 * profiles.tutor.publishedSearchesSeenAt (strictly — isNewPublishedSearch).
 * The threshold is CAPTURED ONCE AT MOUNT so tags stay stable while the
 * tutor reads; visiting the board then writes the new seenAt
 * (serverTimestamp, once per visit, only after a successful snapshot), which
 * clears the app-bar badge live via the authStore's userDoc subscription.
 * The write is fire-and-forget: a failure only means tags reappear next
 * visit.
 *
 * Contacting (PR4): the CTA calls `sendFamilyContactRequest`, which mints a
 * studyContactRequests doc with `initiatedBy: 'tutor'` — the family answers
 * it from their requests list, and only their acceptance unlocks contact.
 * A card whose search this tutor already has a LIVE (pending or accepted)
 * request for shows "Request sent" instead of the button; that set is read
 * from the tutor's own requests, so it survives a reload and a second device.
 * A declined/cancelled prior contact leaves the button available — subject to
 * the server's decline cooldown, which the dialog reports in its own words.
 */
export function PublishedSearchesPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const uid = userDoc?.uid ?? null;

  // Mount-captured New threshold (null = never visited). useState's lazy
  // initializer runs exactly once, so the threshold stays stable while the
  // live userDoc picks up this visit's own seen-write.
  const [seenAtMs] = useState<number | null>(
    () => userDoc?.profiles?.tutor?.publishedSearchesSeenAt?.toMillis?.() ?? null,
  );

  // null = first snapshot pending; [] afterwards may be a real empty board or
  // the error state (errored distinguishes the copy).
  // Shared with the dashboard preview so "active" and "newest" cannot drift.
  const { searches, errored } = usePublishedSearches(50);

  // publishedSearchIds this tutor already has a live request for.
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());
  const [contactTarget, setContactTarget] = useState<BoardSearch | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [sending, setSending] = useState(false);
  // false = no error; 'generic' | 'cooldown' picks the copy.
  const [sendError, setSendError] = useState<false | 'generic' | 'cooldown' | 'hidden'>(false);

  // Which searches this tutor has already answered. Equality-only query on
  // the tutor's own requests (rules: tutorUserId == uid), filtered in code so
  // no composite index is needed; declined/cancelled ones do not count.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'studyContactRequests'), where('tutorUserId', '==', uid)),
      (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const req = d.data() as { publishedSearchId?: string; status?: string };
          if (req.publishedSearchId && (req.status === 'pending' || req.status === 'accepted')) {
            ids.add(req.publishedSearchId);
          }
        });
        setContactedIds(ids);
      },
      () => { /* the CTA simply stays available; the server dedupes */ },
    );
  }, [uid]);

  const handleContact = async () => {
    if (!contactTarget) return;
    setSending(true);
    setSendError(false);
    try {
      const fn = httpsCallable(functions, 'sendFamilyContactRequest');
      await fn({
        publishedSearchId: contactTarget.id,
        ...(contactMessage.trim() ? { message: contactMessage.trim() } : {}),
      });
      // The requests subscription flips the card to "Request sent".
      setContactTarget(null);
      setContactMessage('');
    } catch (err) {
      // The server marks the failures a tutor can ACT on, so neither reads as
      // "the search disappeared": a recent decline by this family, and a
      // profile that is still hidden (the default after enrollment — the
      // board is deliberately unfiltered, so this is the common first tap).
      const reason = (err as { details?: { reason?: string } })?.details?.reason;
      setSendError(
        reason === 'decline_cooldown'
          ? 'cooldown'
          : reason === 'not_searchable'
            ? 'hidden'
            : 'generic',
      );
    } finally {
      setSending(false);
    }
  };

  // Mark the board visited — once, after the first SUCCESSFUL snapshot (an
  // errored subscription must not consume the New tags the tutor never saw).
  const markedRef = useRef(false);
  useEffect(() => {
    if (!uid || searches === null || errored || markedRef.current) return;
    markedRef.current = true;
    updateDoc(doc(db, 'users', uid), {
      'profiles.tutor.publishedSearchesSeenAt': serverTimestamp(),
    }).catch(() => {
      /* tags simply reappear next visit */
    });
  }, [uid, searches, errored]);

  return (
    <div>
      <TopNav title={t('tutor.publishedBoard.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-sm text-gray-500">{t('tutor.publishedBoard.intro')}</p>

        {searches !== null && errored && (
          <p className="py-6 text-center text-sm text-brand-600">{t('tutor.publishedBoard.error')}</p>
        )}

        {searches !== null && !errored && searches.length === 0 && (
          <Card>
            <EmptyState
              icon={<SearchIcon className="h-6 w-6" />}
              message={t('tutor.publishedBoard.empty')}
            />
          </Card>
        )}

        {searches !== null && !errored && searches.map((s) => (
          <PublishedSearchCard
            key={s.id}
            search={s}
            seenAtMs={seenAtMs}
            /* The contact CTA is the card's footer slot: the shared card owns
               WHAT is disclosed, this page owns what the tutor can DO. */
            footer={contactedIds.has(s.id) ? (
              <Badge variant="green">{t('tutor.publishedBoard.contacted')}</Badge>
            ) : (
              <Button size="sm" onClick={() => { setContactTarget(s); setContactMessage(''); setSendError(false); }}>
                {t('tutor.publishedBoard.contact')}
              </Button>
            )}
          />
        ))}
      </div>

      <Dialog open={!!contactTarget} onClose={() => setContactTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">
          {t('tutor.publishedBoard.contactTitle', { name: contactTarget?.familyName ?? '' })}
        </h3>
        <p className="mb-4 text-sm text-gray-600">{t('tutor.publishedBoard.contactDesc')}</p>
        <Textarea
          label={t('tutor.publishedBoard.contactMessageLabel')}
          value={contactMessage}
          onChange={(e) => setContactMessage(e.target.value)}
          placeholder={t('tutor.publishedBoard.contactMessagePlaceholder')}
          maxLength={1000}
        />
        {sendError && (
          <p className="mt-2 text-sm text-brand-600">
            {t(`tutor.publishedBoard.${
              sendError === 'cooldown'
                ? 'contactCooldown'
                : sendError === 'hidden'
                  ? 'contactHidden'
                  : 'contactError'
            }`)}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <Button onClick={handleContact} disabled={sending} className="flex-1">
            {sending ? t('tutor.publishedBoard.contactSending') : t('tutor.publishedBoard.contactSend')}
          </Button>
          <Button variant="ghost" onClick={() => setContactTarget(null)} className="flex-1">
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
