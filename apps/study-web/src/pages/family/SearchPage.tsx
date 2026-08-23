import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, query, where, onSnapshot, deleteDoc } from 'firebase/firestore';
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
  Dialog,
  useToast,
  type AddressResult,
} from '@ejm/shared-ui';
import { TutorCard } from '@/components/family/TutorCard';

/**
 * The family's own active published searches (issue #207) — the subset of the
 * shared publishedSearches doc this page renders and withdraws. Timestamps
 * arrive as Firestore Timestamps; expiry is filtered client-side (there is no
 * status field: active == exists && expiresAt > now).
 */
interface OwnPublishedSearch {
  id: string;
  subject: string;
  level: string;
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

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
  const { t, i18n } = useTranslation();
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
  // postcode/city. Post-#167 family docs carry postcode/city (enrollment and
  // both settings pages persist them), so a doc-seeded address resolves on
  // load; an AddressAutocomplete pick re-resolves from the fresh geocode.
  // Pre-#167 docs stay label-less until the backfill script runs or the
  // family re-picks an address.
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const [familyLoaded, setFamilyLoaded] = useState(false);

  const [results, setResults] = useState<TutorSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  // 'denied' => not verified / not a parent; 'generic' => everything else.
  const [error, setError] = useState<'denied' | 'generic' | null>(null);

  // ── Published searches (issue #207) ──
  const toast = useToast();
  const [myPublished, setMyPublished] = useState<OwnPublishedSearch[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<'cap' | 'generic' | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<OwnPublishedSearch | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  // Live list of the family's own active study published searches. Two
  // equality filters (no composite index needed); newest-first sort and the
  // expiry filter run client-side. A failed subscription hides the section.
  useEffect(() => {
    if (!familyId) return;
    const q = query(
      collection(db, 'publishedSearches'),
      where('familyId', '==', familyId),
      where('app', '==', 'study'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        setMyPublished(
          snap.docs
            .map((d) => d.data() as OwnPublishedSearch)
            .filter((d) => (d.expiresAt?.toMillis?.() ?? 0) > now)
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)),
        );
      },
      () => setMyPublished([]),
    );
  }, [familyId]);

  const handlePublish = async () => {
    if (!isValidSubject(subject) || !isValidLevel(level)) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const fn = httpsCallable(functions, 'publishTutorSearch');
      await fn({
        subject,
        level,
        ...(locationPrefs.length > 0 ? { locationPrefs } : {}),
        ...(maxRate !== '' ? { maxRate: Number(maxRate) } : {}),
      });
      setPublishOpen(false);
      toast(t('family.publish.published'));
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setPublishError(code === 'functions/resource-exhausted' ? 'cap' : 'generic');
    } finally {
      setPublishing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await deleteDoc(doc(db, 'publishedSearches', withdrawTarget.id));
      setWithdrawTarget(null);
      toast(t('family.publish.withdrawn'));
    } catch {
      // Keep the dialog open and say so — a swallowed rules denial or offline
      // failure left the row visibly present but the dialog claimed success
      // (PR #210 review).
      toast(t('family.publish.withdrawError'));
    } finally {
      setWithdrawing(false);
    }
  };

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
          // Resolves from the doc's persisted postcode/city (written by
          // enrollment, both settings pages, and the one-off backfill
          // script). Null only for pre-#167 docs the backfill has not
          // reached — those families see the amber hint until they re-pick
          // an address or the backfill runs.
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
        {/* The family's own active published searches (issue #207) */}
        {myPublished.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('family.publish.myPublished')}</h3>
            {myPublished.map((p) => (
              <Card key={p.id} className="mb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {t(`tutor.subjects.names.${p.subject}`)} ({p.level})
                    </p>
                    <p className="text-xs text-gray-500">
                      {t('family.publish.expiresOn', {
                        date: p.expiresAt.toDate().toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long' }),
                      })}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="w-auto shrink-0" onClick={() => setWithdrawTarget(p)}>
                    {t('family.publish.withdraw')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

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
              <Link to="/family/verification" className="text-xs font-semibold text-amber-900 underline">
                {t('family.search.verifyCta')}
              </Link>
            </div>
          )}

          {!loading && error === 'generic' && (
            <p className="py-6 text-center text-sm text-brand-600">{t('family.search.error')}</p>
          )}

          {/* Publish CTA (issue #207): offered whenever a search has run —
              the demand board reaches tutors this filtered list cannot. */}
          {!loading && !error && results !== null && (
            <Card className="mb-3">
              {/* Stacked, not flex-row: shared-ui Button is w-full and appended
                  width classes lose the Tailwind conflict (stylesheet order),
                  so a row layout crushes the hint to one word per line. */}
              <p className="mb-3 text-xs text-gray-600">{t('family.publish.ctaHint')}</p>
              <Button size="sm" variant="outline" onClick={() => setPublishOpen(true)}>
                {t('family.publish.cta')}
              </Button>
            </Card>
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

      {/* Publish Confirmation Dialog (issue #207) */}
      {publishOpen && (
        <Dialog open onClose={() => { setPublishOpen(false); setPublishError(null); }}>
          <h3 className="mb-2 text-lg font-bold">{t('family.publish.confirmTitle')}</h3>
          <p className="mb-2 text-sm text-gray-600">{t('family.publish.confirmDesc')}</p>
          <p className="mb-2 text-sm text-gray-600">{t('family.publish.duration')}</p>
          {publishError && (
            <p className="mb-3 text-sm text-brand-600">
              {publishError === 'cap' ? t('family.publish.capError') : t('family.publish.error')}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button onClick={handlePublish} disabled={publishing} className="flex-1">
              {publishing ? t('family.publish.publishing') : t('family.publish.confirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => { setPublishOpen(false); setPublishError(null); }} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      )}

      {/* Withdraw Published Search Dialog (issue #207) */}
      {withdrawTarget && (
        <Dialog open onClose={() => setWithdrawTarget(null)}>
          <h3 className="mb-2 text-lg font-bold">{t('family.publish.withdrawTitle')}</h3>
          <p className="mb-4 text-sm text-gray-600">{t('family.publish.withdrawDesc')}</p>
          <div className="flex gap-2">
            <Button onClick={handleWithdraw} disabled={withdrawing} className="flex-1">
              {withdrawing ? t('family.publish.withdrawing') : t('family.publish.withdraw')}
            </Button>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
