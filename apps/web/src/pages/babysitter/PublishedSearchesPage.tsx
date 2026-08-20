import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Badge, Button, Dialog, Textarea, TopNav } from '@/components/ui';
import { SearchIcon } from '@/components/ui/Icons';
import { getBabysitterView } from '@ejm/sit-core';
import { usePublishedSearches, type BoardSearch } from '@/components/published/usePublishedSearches';
import { PublishedSearchCard } from '@/components/published/PublishedSearchCard';

/**
 * Published-searches board for babysitters (issue #207). Lists every ACTIVE
 * sit published search — deliberately unfiltered by the sitter's own
 * availability or searchable flag (the board's whole point) — newest first.
 *
 * "New" tagging: a doc is New iff createdAt > the sitter's stored
 * profiles.babysitter.publishedSearchesSeenAt (strictly — see
 * isNewPublishedSearch). The threshold is CAPTURED ONCE AT MOUNT so tags stay
 * stable while the sitter reads; visiting the board then writes the new
 * seenAt (serverTimestamp, once per visit, only after a successful snapshot),
 * which clears the app-bar badge live via the authStore's userDoc
 * subscription. The write is fire-and-forget: a failure only means tags
 * reappear next visit.
 *
 * Contacting (PR3): the CTA calls `contactPublishedSearch`, which mints a
 * pending appointment with `initiatedBy: 'babysitter'` — the family answers it
 * from their dashboard, and only their acceptance releases their address. A
 * card whose search this sitter already has a LIVE (pending or confirmed)
 * appointment for shows "Request sent" instead of the button; that set is read
 * from the sitter's own appointments (the same query the dashboard uses), so it
 * survives a reload and a second device. A declined/cancelled prior contact
 * leaves the button available — the server agrees.
 */
export function PublishedSearchesPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const uid = userDoc?.uid ?? null;

  // Mount-captured New threshold (null = never visited). useState's lazy
  // initializer runs exactly once, so the threshold stays stable while the
  // live userDoc picks up this visit's own seen-write.
  const [seenAtMs] = useState<number | null>(
    () => getBabysitterView(userDoc)?.publishedSearchesSeenAt?.toMillis?.() ?? null,
  );

  // Shared with the dashboard preview so "active" and "newest" cannot drift.
  const { searches, errored } = usePublishedSearches(50);

  // publishedSearchIds this sitter already has a live appointment for.
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());
  const [contactTarget, setContactTarget] = useState<BoardSearch | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  // Which searches this sitter has already answered. Equality-only query on
  // the sitter's own appointments (rules: babysitterUserId == uid), filtered in
  // code so no composite index is needed; rejected/cancelled ones do not count.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'appointments'), where('babysitterUserId', '==', uid)),
      (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const apt = d.data() as { publishedSearchId?: string | null; status?: string };
          if (apt.publishedSearchId && (apt.status === 'pending' || apt.status === 'confirmed')) {
            ids.add(apt.publishedSearchId);
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
      const fn = httpsCallable(functions, 'contactPublishedSearch');
      await fn({
        publishedSearchId: contactTarget.id,
        ...(contactMessage.trim() ? { message: contactMessage.trim() } : {}),
      });
      // The appointments subscription flips the card to "Request sent".
      setContactTarget(null);
      setContactMessage('');
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  // Mark the board visited — once, after the first SUCCESSFUL snapshot (an
  // errored subscription must not consume the New tags the sitter never saw).
  const markedRef = useRef(false);
  useEffect(() => {
    if (!uid || searches === null || errored || markedRef.current) return;
    markedRef.current = true;
    updateDoc(doc(db, 'users', uid), {
      'profiles.babysitter.publishedSearchesSeenAt': serverTimestamp(),
    }).catch(() => {
      /* tags simply reappear next visit */
    });
  }, [uid, searches, errored]);

  return (
    <div>
      <TopNav title={t('publishedBoard.title')} backTo="/babysitter" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-sm text-gray-500">{t('publishedBoard.intro')}</p>

        {searches === null && null}

        {searches !== null && errored && (
          <p className="py-6 text-center text-sm text-brand-600">{t('publishedBoard.error')}</p>
        )}

        {searches !== null && !errored && searches.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <SearchIcon className="h-6 w-6 text-gray-400" />
            </div>
            <p className="max-w-[280px] text-sm text-gray-500">{t('publishedBoard.empty')}</p>
          </div>
        )}

        {searches !== null && !errored && searches.map((s) => (
          <PublishedSearchCard
            key={s.id}
            search={s}
            seenAtMs={seenAtMs}
            /* The contact CTA is the card's footer slot (PR3): the shared card
               owns WHAT is disclosed, this page owns what the sitter can DO. */
            footer={contactedIds.has(s.id) ? (
              <Badge variant="green">{t('publishedBoard.contacted')}</Badge>
            ) : (
              <Button size="sm" onClick={() => { setContactTarget(s); setContactMessage(''); setSendError(false); }}>
                {t('publishedBoard.contact')}
              </Button>
            )}
          />
        ))}
      </div>

      <Dialog open={!!contactTarget} onClose={() => setContactTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">
          {t('publishedBoard.contactTitle', { name: contactTarget?.familyName ?? '' })}
        </h3>
        <p className="mb-4 text-sm text-gray-600">{t('publishedBoard.contactDesc')}</p>
        <Textarea
          label={t('publishedBoard.contactMessageLabel')}
          value={contactMessage}
          onChange={(e) => setContactMessage(e.target.value)}
          placeholder={t('publishedBoard.contactMessagePlaceholder')}
          maxLength={1000}
        />
        {sendError && (
          <p className="mt-2 text-sm text-brand-600">{t('publishedBoard.contactError')}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Button onClick={handleContact} disabled={sending} className="flex-1">
            {sending ? t('publishedBoard.contactSending') : t('publishedBoard.contactSend')}
          </Button>
          <Button variant="ghost" onClick={() => setContactTarget(null)} className="flex-1">
            {t('request.goBack')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
