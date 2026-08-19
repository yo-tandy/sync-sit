import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Badge, Card, TopNav, EmptyState, SearchIcon } from '@ejm/shared-ui';
import { isActivePublishedSearch, isNewPublishedSearch } from '@ejm/shared-core';

/**
 * The published-searches board doc as this page renders it (issue #207,
 * study side): the PII the publish callable deliberately exposed —
 * familyName, area LABEL, subject+level, location prefs, max rate — and
 * nothing more (no address/latLng exists on the doc).
 */
interface BoardSearch {
  id: string;
  familyName: string;
  areaLabel: string | null;
  subject: string;
  level: string;
  locationPrefs: string[];
  maxRate: number | null;
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

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
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const uid = userDoc?.uid ?? null;
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  // Mount-captured New threshold (null = never visited). useState's lazy
  // initializer runs exactly once, so the threshold stays stable while the
  // live userDoc picks up this visit's own seen-write.
  const [seenAtMs] = useState<number | null>(
    () => userDoc?.profiles?.tutor?.publishedSearchesSeenAt?.toMillis?.() ?? null,
  );

  // null = first snapshot pending; [] afterwards may be a real empty board or
  // the error state (errored distinguishes the copy).
  const [searches, setSearches] = useState<BoardSearch[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'publishedSearches'),
      where('app', '==', 'study'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        setSearches(
          snap.docs
            .map((d) => d.data() as BoardSearch)
            .filter((d) => isActivePublishedSearch(d, now)),
        );
      },
      () => {
        setSearches([]);
        setErrored(true);
      },
    );
  }, []);

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
          <Card key={s.id} className="mb-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-gray-900">
                {t(`tutor.subjects.names.${s.subject}`)} ({s.level})
              </p>
              {isNewPublishedSearch(s, seenAtMs) && (
                <Badge variant="amber">{t('tutor.publishedBoard.newTag')}</Badge>
              )}
            </div>

            <p className="mt-1 text-sm text-gray-700">
              {t('tutor.publishedBoard.familyTitle', { name: s.familyName })}
            </p>
            {s.areaLabel && (
              <p className="text-sm text-gray-500">{t('tutor.publishedBoard.area', { area: s.areaLabel })}</p>
            )}
            {s.locationPrefs.length > 0 && (
              <p className="text-sm text-gray-500">
                {s.locationPrefs.map((p) => t(`family.search.location.${p}`)).join(', ')}
              </p>
            )}
            {s.maxRate != null && (
              <p className="text-sm text-gray-500">{t('tutor.publishedBoard.maxRate', { rate: s.maxRate })}</p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400">
                {t('tutor.publishedBoard.expires', {
                  date: s.expiresAt.toDate().toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
                })}
              </p>
              {/* No contact CTA yet — PR4; say so instead of a dead button. */}
              <p className="text-xs text-gray-400">{t('tutor.publishedBoard.contactSoon')}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
