import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, TopNav, EmptyState, SearchIcon } from '@ejm/shared-ui';
import { usePublishedSearches } from '@/components/published/usePublishedSearches';
import { PublishedSearchCard } from '@/components/published/PublishedSearchCard';

/**
 * The published-searches board doc as this page renders it (issue #207,
 * study side): the PII the publish callable deliberately exposed —
 * familyName, area LABEL, subject+level, location prefs, max rate — and
 * nothing more (no address/latLng exists on the doc).
 */
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
 * No contact CTA yet: contacting the family ships in the next update (PR4);
 * each card says so instead of rendering a dead button.
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
            /* No contact CTA yet — PR4; say so instead of a dead button. */
            footer={<p className="text-xs text-gray-400">{t('tutor.publishedBoard.contactSoon')}</p>}
          />
        ))}
      </div>
    </div>
  );
}
