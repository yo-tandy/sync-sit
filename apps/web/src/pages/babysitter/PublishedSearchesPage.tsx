import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav } from '@/components/ui';
import { SearchIcon } from '@/components/ui/Icons';
import { getBabysitterView } from '@ejm/sit-core';
import { usePublishedSearches } from '@/components/published/usePublishedSearches';
import { PublishedSearchCard } from '@/components/published/PublishedSearchCard';

/**
 * The published-searches board doc as this page renders it (issue #207, sit
 * side): the PII the publish callable deliberately exposed — familyName,
 * area LABEL, schedule, kid ages, rate, additionalInfo — and nothing more
 * (no address/latLng/kid names exist on the doc).
 */
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
 * No contact CTA yet: contacting the family ships in the next update (PR3);
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
    () => getBabysitterView(userDoc)?.publishedSearchesSeenAt?.toMillis?.() ?? null,
  );

  // Shared with the dashboard preview so "active" and "newest" cannot drift.
  const { searches, errored } = usePublishedSearches(50);

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
            /* No contact CTA yet — PR3; say so instead of a dead button. */
            footer={<p className="text-xs text-gray-400">{t('publishedBoard.contactSoon')}</p>}
          />
        ))}
      </div>
    </div>
  );
}
