import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
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
 * the backend can compute distance. `?subject=&level=` deep-links (used by the
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

  // Optional filters. locationPref is single-select (the callable takes one).
  const [locationPref, setLocationPref] = useState('');
  const [maxRate, setMaxRate] = useState<number | ''>('');
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | ''>('');

  // Caller's search origin. Seeded from the shared family doc but user-editable
  // via AddressAutocomplete — a family whose doc has no latLng can type one in,
  // and clearing the field drops latLng (and any maxDistanceKm filter) entirely.
  const [address, setAddress] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | undefined>();
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
    async (s: string, l: string) => {
      if (!isValidSubject(s) || !isValidLevel(l)) return;
      setLoading(true);
      setError(null);
      const filters: { locationPref?: string; maxRate?: number; maxDistanceKm?: number } = {};
      if (locationPref) filters.locationPref = locationPref;
      if (maxRate !== '') filters.maxRate = Number(maxRate);
      if (maxDistanceKm !== '') filters.maxDistanceKm = Number(maxDistanceKm);
      const payload = {
        subject: s,
        level: l,
        ...(latLng ? { latLng } : {}),
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
    [locationPref, maxRate, maxDistanceKm, latLng],
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

  // Clears the OPTIONAL filters only — subject/level are the mandatory search
  // inputs and the address is the search origin, so both stay put. The user
  // re-runs the search themselves (the results they see still match the
  // filters they see until they do).
  const clearFilters = () => {
    setLocationPref('');
    setMaxRate('');
    setMaxDistanceKm('');
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
                  selected={locationPref === pref}
                  onClick={() => setLocationPref((prev) => (prev === pref ? '' : pref))}
                >
                  {t(`family.search.location.${pref}`)}
                </Chip>
              ))}
            </div>
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
              <EmptyState
                icon={<SearchIcon className="h-6 w-6" />}
                message={t('family.search.empty')}
                actionLabel={t('family.search.emptyAction')}
                onAction={clearFilters}
              />
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
