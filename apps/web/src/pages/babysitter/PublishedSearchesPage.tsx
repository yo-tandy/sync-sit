import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Badge, Card, TopNav } from '@/components/ui';
import { SearchIcon } from '@/components/ui/Icons';
import { getBabysitterView } from '@ejm/sit-core';
import { isActivePublishedSearch, isNewPublishedSearch } from '@ejm/shared-core';

/**
 * The published-searches board doc as this page renders it (issue #207, sit
 * side): the PII the publish callable deliberately exposed — familyName,
 * area LABEL, schedule, kid ages, rate, additionalInfo — and nothing more
 * (no address/latLng/kid names exist on the doc).
 */
interface BoardSearch {
  id: string;
  familyName: string;
  areaLabel: string | null;
  type: 'one_time' | 'recurring';
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  recurringSlots: { day: string; startTime: string; endTime: string }[] | null;
  schoolWeeksOnly: boolean;
  kidAges: number[];
  numberOfKids: number;
  offeredRate: number | null;
  additionalInfo: string | null;
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

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
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const uid = userDoc?.uid ?? null;
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  // Mount-captured New threshold (null = never visited). useState's lazy
  // initializer runs exactly once, so the threshold stays stable while the
  // live userDoc picks up this visit's own seen-write.
  const [seenAtMs] = useState<number | null>(
    () => getBabysitterView(userDoc)?.publishedSearchesSeenAt?.toMillis?.() ?? null,
  );

  // null = first snapshot pending; [] afterwards may be a real empty board or
  // the error state (errored distinguishes the copy).
  const [searches, setSearches] = useState<BoardSearch[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'publishedSearches'),
      where('app', '==', 'sit'),
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

  const dayNames: Record<string, string> = {
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  };

  const formatSchedule = (s: BoardSearch): string => {
    if (s.type === 'one_time' && s.date) {
      const d = new Date(s.date + 'T00:00:00').toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      return `${d}, ${s.startTime}–${s.endTime}`;
    }
    return (s.recurringSlots ?? [])
      .map((slot) => `${dayNames[slot.day] || slot.day} ${slot.startTime}–${slot.endTime}`)
      .join(', ');
  };

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
          <Card key={s.id} className="mb-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-gray-900">
                {t('publishedBoard.familyTitle', { name: s.familyName })}
              </p>
              {isNewPublishedSearch(s, seenAtMs) && (
                <Badge variant="amber">{t('publishedBoard.newTag')}</Badge>
              )}
            </div>

            <p className="mt-1 text-sm text-gray-700">{formatSchedule(s)}</p>
            {s.type === 'recurring' && s.schoolWeeksOnly && (
              <p className="text-xs text-gray-500">{t('search.schoolWeeksOnly')}</p>
            )}

            <p className="mt-1 text-sm text-gray-500">
              {t('publishedBoard.kids', { count: s.numberOfKids, ages: s.kidAges.join(', ') })}
            </p>
            {s.areaLabel && (
              <p className="text-sm text-gray-500">{t('publishedBoard.area', { area: s.areaLabel })}</p>
            )}
            {s.offeredRate != null && (
              <p className="text-sm text-gray-500">{t('publishedBoard.rate', { rate: s.offeredRate })}</p>
            )}
            {s.additionalInfo && (
              <p className="mt-2 text-sm text-gray-600">{s.additionalInfo}</p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400">
                {t('publishedBoard.expires', {
                  date: s.expiresAt.toDate().toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
                })}
              </p>
              {/* No contact CTA yet — PR3; say so instead of a dead button. */}
              <p className="text-xs text-gray-400">{t('publishedBoard.contactSoon')}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
