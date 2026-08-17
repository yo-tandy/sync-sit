import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile, resolveAreaLabel } from '@ejm/shared-core';
import {
  SUBJECTS,
  CLASS_LEVELS,
  LOCATION_PREFS,
  type TutorSearchResult,
} from '@ejm/study-core';
import {
  Button,
  Select,
  Input,
  Chip,
  Card,
  TopNav,
  Spinner,
  AddressAutocomplete,
  EmptyState,
  SearchIcon,
  type AddressResult,
} from '@ejm/shared-ui';
import { TutorCard } from '@/components/family/TutorCard';

/**
 * Tutor search for verified families. A single-step form (subject + level +
 * optional filters) posts to the `searchTutors` callable and renders the
 * projected tutor rows.
 *
 * The caller's saved address/latLng is loaded once from the shared `families/{id}`
 * doc (mirroring the family dashboard/settings idiom) and passed as `latLng` so
 * the backend can compute distance. An AddressAutocomplete pick additionally
 * resolves the postcode/city to a coverage-area label (issue #167) that the
 * backend intersects with arrondissement-mode tutors' areas when the search
 * asks for home/library sessions. `?subject=&level=` deep-links (used by the
 * family requests page) prefill the form and auto-run the search once the family
 * doc has resolved.
 *
 * A `permission-denied` from the callable means the family is not verified (or
 * the caller is not a parent); we surface the dashboard's verification copy and
 * link back rather than an opaque error.
 *
 * Each result renders as a TutorCard (avatar, endorsements, consent-gated
 * contact CTA).
 */
export function SearchPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;
  const [searchParams] = useSearchParams();

  const isValidSubject = (s: string | null): s is string =>
    !!s && (SUBJECTS as readonly string[]).includes(s);
  const isValidLevel = (l: string | null): l is string =>
    !!l && (CLASS_LEVELS as readonly string[]).includes(l);

  // Prefill from the deep-link query params when they are valid taxonomy values.
  const [subject, setSubject] = useState(() => {
    const q = searchParams.get('subject');
    return isValidSubject(q) ? q : '';
  });
  const [level, setLevel] = useState(() => {
    const q = searchParams.get('level');
    return isValidLevel(q) ? q : '';
  });

  // Optional filters. locationPrefs is multi-select (issue #167): the set of
  // session-location types the family wants; the callable intersects it with
  // each tutor's prefs.
  const [locationPrefs, setLocationPrefs] = useState<string[]>([]);
  const [maxRate, setMaxRate] = useState<number | ''>('');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | ''>('');

  // Caller's search origin. Seeded from the shared family doc but user-editable
  // via AddressAutocomplete — a family whose doc has no latLng can type one in,
  // and clearing the field drops latLng (and any maxDistanceKm filter) entirely.
  const [address, setAddress] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | undefined>();
  // Coverage-area label ('16e', 'Vincennes', …) resolved from the address's
  // postcode/city. Only an AddressAutocomplete pick carries postcode/city —
  // the family doc stores just the display string + latLng — so a doc-seeded
  // address starts with NO label until the family re-picks one here.
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const [familyLoaded, setFamilyLoaded] = useState(false);

  const [results, setResults] = useState<TutorSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  // 'denied' => not verified / not a parent; 'generic' => everything else.
  const [error, setError] = useState<'denied' | 'generic' | null>(null);

  // Load the family doc once for the saved address/latLng.
  useEffect(() => {
    if (!familyId) {
      setFamilyLoaded(true);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'families', familyId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          setAddress(snap.data()?.address ?? '');
          setLatLng(snap.data()?.latLng ?? undefined);
          // KNOWN GAP: today the family doc persists only the display address
          // + latLng (enrollment discards the geocoder's postcode/city), so
          // this resolves to null for doc-seeded addresses and the label only
          // exists after an explicit autocomplete pick. Tolerant read so any
          // future postcode/city backfill lights this up without a change here.
          setAreaLabel(
            resolveAreaLabel({
              postcode: snap.data()?.postcode ?? undefined,
              city: snap.data()?.city ?? undefined,
            }),
          );
        }
      })
      .catch(() => {
        /* leave latLng unset — distance is optional */
      })
      .finally(() => {
        if (!cancelled) setFamilyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  const runSearch = useCallback(
    // `overrides` exists for callers that change filter state and re-run in
    // the same tick (clear-filters): runSearch closes over the filter state,
    // so without it they would search with the STALE values.
    async (
      s: string,
      l: string,
      overrides?: { locationPrefs: string[]; maxRate: number | ''; maxDistanceKm: number | '' },
    ) => {
      if (!isValidSubject(s) || !isValidLevel(l)) return;
      setLoading(true);
      setError(null);
      const effLocationPrefs = overrides ? overrides.locationPrefs : locationPrefs;
      const effMaxRate = overrides ? overrides.maxRate : maxRate;
      const effMaxDistanceKm = overrides ? overrides.maxDistanceKm : maxDistanceKm;
      const filters: { locationPrefs?: string[]; maxRate?: number; maxDistanceKm?: number } = {};
      if (effLocationPrefs.length > 0) filters.locationPrefs = effLocationPrefs;
      if (effMaxRate !== '') filters.maxRate = Number(effMaxRate);
      if (effMaxDistanceKm !== '') filters.maxDistanceKm = Number(effMaxDistanceKm);
      const payload = {
        subject: s,
        level: l,
        ...(latLng ? { latLng } : {}),
        ...(areaLabel ? { areaLabel } : {}),
        ...(Object.keys(filters).length ? { filters } : {}),
      };
      try {
        const fn = httpsCallable<typeof payload, { results: TutorSearchResult[] }>(
          functions,
          'searchTutors',
        );
        const res = await fn(payload);
        setResults(res.data.results ?? []);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        setError(code === 'functions/permission-denied' ? 'denied' : 'generic');
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [locationPrefs, maxRate, maxDistanceKm, latLng, areaLabel],
  );

  // Auto-search on mount for valid deep-links, once the family doc resolves so
  // latLng is included in the payload. Guarded to fire at most once.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!familyLoaded || autoRanRef.current) return;
    const qSubject = searchParams.get('subject');
    const qLevel = searchParams.get('level');
    if (isValidSubject(qSubject) && isValidLevel(qLevel)) {
      autoRanRef.current = true;
      runSearch(qSubject, qLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyLoaded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(subject, level);
  };

  // Whether the empty state has anything to offer: with no optional filters
  // set, "Clear filters" would be a visible no-op, so the CTA is withheld and
  // EmptyState degrades to icon + message.
  const hasOptionalFilters = locationPrefs.length > 0 || maxRate !== '' || maxDistanceKm !== '';

  // Clears the OPTIONAL filters only — subject/level are the mandatory search
  // inputs and the address is the search origin, so both stay put — and
  // re-runs the search with the cleared values so the results visibly react.
  const clearFilters = () => {
    setLocationPrefs([]);
    setMaxRate('');
    setMaxDistanceKm('');
    runSearch(subject, level, { locationPrefs: [], maxRate: '', maxDistanceKm: '' });
  };

  const subjectOptions = SUBJECTS.map((s) => ({
    value: s,
    label: t(`tutor.subjects.names.${s}`),
  }));
  const levelOptions = CLASS_LEVELS.map((l) => ({ value: l, label: l }));
  const canSearch = isValidSubject(subject) && isValidLevel(level) && !loading;

  return (
    <div>
      <TopNav title={t('family.searchTitle')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        <form onSubmit={handleSubmit}>
          <Select
            label={t('family.search.subjectLabel')}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('family.search.selectSubject')}
            options={subjectOptions}
          />

          <Select
            label={t('family.search.levelLabel')}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder={t('family.search.selectLevel')}
            options={levelOptions}
          />

          {/* ── Optional filters ── */}
          <p className="mb-2 text-sm font-semibold text-gray-700">
            {t('family.search.filtersTitle')}
          </p>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('family.search.locationLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              {LOCATION_PREFS.map((pref) => (
                <Chip
                  key={pref}
                  selected={locationPrefs.includes(pref)}
                  onClick={() =>
                    setLocationPrefs((prev) =>
                      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref],
                    )
                  }
                >
                  {t(`family.search.location.${pref}`)}
                </Chip>
              ))}
            </div>
            {/* Home/library filtering matches tutors' coverage areas against
                the family's resolved area label; without one (address not
                picked, or outside Paris/nearby towns) only distance-based
                tutors can match — say so instead of silently thinning results. */}
            {(locationPrefs.includes('family_home') || locationPrefs.includes('library')) &&
              !areaLabel && (
                <p className="mt-2 text-xs text-amber-600">{t('family.search.areaHint')}</p>
              )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('family.search.maxRateLabel')}
                type="number"
                value={maxRate}
                onChange={(e) =>
                  setMaxRate(e.target.value === '' ? '' : Number(e.target.value))
                }
                min={0}
                step="0.5"
              />
            </div>
            <div className="flex-1">
              <Input
                label={t('family.search.maxDistanceLabel')}
                type="number"
                value={maxDistanceKm}
                onChange={(e) =>
                  setMaxDistanceKm(e.target.value === '' ? '' : Number(e.target.value))
                }
                min={0}
                step="1"
              />
            </div>
          </div>

          {/* Search origin — seeded from the family doc, overridable. Distance is
              only computed by the backend when latLng is present. The `key` remounts
              the input once the (async) family doc resolves so its internal query
              state picks up the seeded address (it initialises from `value` once). */}
          <AddressAutocomplete
            key={familyLoaded ? 'addr-loaded' : 'addr-loading'}
            label={t('family.search.addressLabel')}
            value={
              address
                ? {
                    fullAddress: address,
                    street: '',
                    city: '',
                    postcode: '',
                    lat: latLng?.lat || 0,
                    lng: latLng?.lng || 0,
                  }
                : null
            }
            onChange={(addr: AddressResult | null) => {
              setAddress(addr?.fullAddress || '');
              setLatLng(addr ? { lat: addr.lat, lng: addr.lng } : undefined);
              setAreaLabel(
                addr ? resolveAreaLabel({ postcode: addr.postcode, city: addr.city }) : null,
              );
            }}
          />

          <Button type="submit" disabled={!canSearch}>
            {loading ? t('family.search.searching') : t('family.search.submit')}
          </Button>
        </form>

        {/* ── Results / states ── */}
        <div className="mt-6">
          {loading && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}

          {!loading && error === 'denied' && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
              <p className="mb-1 text-sm font-semibold">
                {t('family.dashboard.verifyBannerTitle')}
              </p>
              <p className="mb-3 text-xs text-amber-700">
                {t('family.dashboard.verifyBannerDesc')}
              </p>
              <Link to="/family" className="text-xs font-semibold text-amber-900 underline">
                {t('family.search.verifyCta')}
              </Link>
            </div>
          )}

          {!loading && error === 'generic' && (
            <p className="py-6 text-center text-sm text-brand-600">{t('family.search.error')}</p>
          )}

          {!loading && !error && results !== null && results.length === 0 && (
            <Card>
              {hasOptionalFilters ? (
                <EmptyState
                  icon={<SearchIcon className="h-6 w-6" />}
                  message={t('family.search.empty')}
                  actionLabel={t('family.search.emptyAction')}
                  onAction={clearFilters}
                />
              ) : (
                <EmptyState icon={<SearchIcon className="h-6 w-6" />} message={t('family.search.empty')} />
              )}
            </Card>
          )}

          {!loading && !error && results !== null && results.length > 0 && (
            <div className="space-y-3">
              {results.map((r) => (
                <TutorCard key={r.uid} result={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
