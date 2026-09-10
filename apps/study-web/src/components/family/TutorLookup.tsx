import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { TutorLookupResult, TutorSearchResult } from '@ejm/study-core';
import { Card, Select, Spinner } from '@ejm/shared-ui';
import { TutorCard } from '@/components/family/TutorCard';

/**
 * Direct tutor lookup by name, email, or phone (issue #437) — the entry
 * point for a family who already knows who they're looking for and doesn't
 * want to hunt through search filters. Replaces the earlier personal-code
 * form (issue #235): a query can match several tutors, so this is a
 * debounced free-text search returning a list, modeled on sit's
 * PreferredBabysittersPage rather than a single-code resolve.
 *
 * Each result's card is the shared TutorCard, deliberately: its CTA mints
 * the NORMAL contact request (sendTutorContactRequest with all its guards),
 * so this path cannot drift into a bypass of the approvedFamilies unlock.
 */
export function TutorLookup() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TutorLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<'denied' | 'generic' | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setHasSearched(false);
      setError(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const fn = httpsCallable<{ query: string }, { results: TutorLookupResult[] }>(
          functions,
          'lookupTutor',
        );
        const res = await fn({ query: q });
        setResults(res.data.results);
        setHasSearched(true);
        setError(null);
      } catch (err: unknown) {
        const errCode = (err as { code?: string })?.code;
        setError(errCode === 'functions/permission-denied' ? 'denied' : 'generic');
        setResults([]);
        setHasSearched(true);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Card className="mb-6">
      <h3 className="mb-1 text-sm font-semibold text-gray-700">
        {t('family.search.lookup.title')}
      </h3>
      <p className="mb-3 text-xs text-gray-500">{t('family.search.lookup.desc')}</p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('family.search.lookup.searchPlaceholder')}
        aria-label={t('family.search.lookup.searchPlaceholder')}
        className="h-11 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-sm text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-brand-600"
      />

      {error === 'generic' && (
        <p className="mt-2 text-sm text-brand-600">{t('family.search.error')}</p>
      )}
      {/* Same recovery path the search denial shows: verification is the
          missing step, and the query will still be here afterwards. */}
      {error === 'denied' && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <p className="mb-1 text-sm font-semibold">{t('family.dashboard.verifyBannerTitle')}</p>
          <p className="mb-3 text-xs text-amber-700">{t('family.dashboard.verifyBannerDesc')}</p>
          <Link to="/family/verification" className="text-xs font-semibold text-amber-900 underline">
            {t('family.search.verifyCta')}
          </Link>
        </div>
      )}

      {searching && (
        <div className="mt-3 flex justify-center">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      )}

      {!searching && !error && hasSearched && results.length === 0 && (
        <p className="mt-3 text-center text-sm text-gray-500">{t('family.search.lookup.noResults')}</p>
      )}

      {!searching && results.length > 0 && (
        <div className="mt-4 space-y-4">
          {results.map((result) => (
            <TutorLookupResultCard key={result.uid} result={result} />
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * One matched tutor's subject/level picker + card. Extracted so each result
 * in the list owns its own picker state (issue #437) — a single shared
 * picker only ever made sense for the one-result-per-code shape this
 * replaces.
 */
function TutorLookupResultCard({ result }: { result: TutorLookupResult }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(result.subjects[0]?.subject ?? '');
  const [level, setLevel] = useState(result.subjects[0]?.levels[0] ?? '');

  const offering = result.subjects.find((o) => o.subject === subject);

  // The shared card's shape, assembled from the lookup result + the picked
  // offering. Built inline (cheap) rather than memoized state so a picker
  // change re-derives it without sync effects.
  const cardResult: TutorSearchResult | null =
    offering && level
      ? {
          uid: result.uid,
          firstName: result.firstName,
          lastName: result.lastName,
          photoUrl: result.photoUrl,
          languages: result.languages,
          aboutMe: result.aboutMe,
          classLevel: result.classLevel,
          subject,
          level,
          rate: offering.rate,
          levels: offering.levels,
          sessionLengthsMin: result.sessionLengthsMin,
          locationPrefs: result.locationPrefs,
          distance: result.distance,
          endorsementCount: result.endorsementCount,
          cancellationNoticeHours: result.cancellationNoticeHours,
          requestStatus: result.requestStatus,
          contactEmail: result.contactEmail,
          contactPhone: result.contactPhone,
          whatsapp: result.whatsapp,
        }
      : null;

  if (result.subjects.length === 0) {
    // A resolvable tutor with zero offerings should not exist (search
    // requires an offering match to surface anyone), but a lookup has no
    // query to filter on — degrade to copy, not a crash.
    return <p className="text-sm text-gray-600">{t('family.search.lookup.noSubjects')}</p>;
  }

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex-1">
          {/* Explicit ids: the Select derives its id from the label text,
              and each result renders its own pair — two results must not
              share an id. */}
          <Select
            id={`tutor-lookup-subject-${result.uid}`}
            label={t('family.search.subjectLabel')}
            value={subject}
            onChange={(e) => {
              const next = e.target.value;
              setSubject(next);
              // Each offering carries its own levels; keep the level picker
              // honest by resetting to the new offering's first.
              setLevel(result.subjects.find((o) => o.subject === next)?.levels[0] ?? '');
            }}
            options={result.subjects.map((o) => ({
              value: o.subject,
              label: t(`tutor.subjects.names.${o.subject}`),
            }))}
          />
        </div>
        <div className="flex-1">
          <Select
            id={`tutor-lookup-level-${result.uid}`}
            label={t('family.search.levelLabel')}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            options={(offering?.levels ?? []).map((l) => ({ value: l, label: l }))}
          />
        </div>
      </div>
      {cardResult && <TutorCard result={cardResult} />}
    </div>
  );
}
