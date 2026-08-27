import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, query, where, limit, onSnapshot, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  Button, Card, Input, Select, Textarea, Chip, TopNav, Dialog, Avatar, useToast,
} from '@/components/ui';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { formatBabysitterName } from '@/lib/formatName';
import { debouncedTogglePreferred } from '@/lib/debouncedPreferred';
import { CheckIcon, ShieldIcon } from '@/components/ui/Icons';
import { useHolidays } from '@/hooks/useHolidays';
import { getDateTag } from '@/lib/dateTag';
import { DateTag } from '@/components/ui/DateTag';
import type { FamilyDoc, KidDoc, BabysitterSummary } from '@ejm/sit-core';
import { getParentView } from '@ejm/sit-core';

// Time options 06:00–02:00
function generateTimeOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let h = 6; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      opts.push({ value: t, label: t });
    }
  }
  for (let h = 0; h <= 2; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 2 && m > 0) break;
      const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      opts.push({ value: t, label: h < 2 || m === 0 ? `${t} (following day)` : t });
    }
  }
  return opts;
}
const TIME_OPTIONS = generateTimeOptions();

/**
 * The family's own active published searches (issue #207) — the subset of the
 * shared publishedSearches doc this page renders and withdraws. Timestamps
 * arrive as Firestore Timestamps; expiry is filtered client-side (there is no
 * status field: active == exists && expiresAt > now).
 */
interface OwnPublishedSearch {
  id: string;
  type: 'one_time' | 'recurring';
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  recurringSlots: { day: string; startTime: string; endTime: string }[] | null;
  kidAges: number[];
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

export function SearchPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const parent = getParentView(userDoc);
  const navigate = useNavigate();

  const GENDER_OPTIONS = [
    { value: 'any', label: t('search.any') },
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
  ];

  const [step, setStep] = useState<'type' | 'details' | 'results'>('type');
  const [searchType, setSearchType] = useState<'one_time' | 'recurring'>('one_time');

  // Family data
  const [_family, setFamily] = useState<FamilyDoc | null>(null);
  const [kids, setKids] = useState<(KidDoc & { selected: boolean })[]>([]);

  // Search form — one-time
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('22:00');

  // Search form — recurring
  interface RecurringSlot { day: string; startTime: string; endTime: string; enabled: boolean }
  const [recurringSlots, setRecurringSlots] = useState<RecurringSlot[]>([
    { day: 'mon', startTime: '16:00', endTime: '19:00', enabled: false },
    { day: 'tue', startTime: '16:00', endTime: '19:00', enabled: false },
    { day: 'wed', startTime: '14:00', endTime: '18:00', enabled: false },
    { day: 'thu', startTime: '16:00', endTime: '19:00', enabled: false },
    { day: 'fri', startTime: '16:00', endTime: '19:00', enabled: false },
    { day: 'sat', startTime: '10:00', endTime: '14:00', enabled: false },
    { day: 'sun', startTime: '10:00', endTime: '14:00', enabled: false },
  ]);
  const [schoolWeeksOnly, setSchoolWeeksOnly] = useState(true);

  // Search form — common
  const [address, setAddress] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [offeredRate, setOfferedRate] = useState<number>(15);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [filterMinAge, setFilterMinAge] = useState<number>(15);
  const [filterGender, setFilterGender] = useState('any');
  const [filterRequireRefs, setFilterRequireRefs] = useState(false);

  // Results
  const [results, setResults] = useState<BabysitterSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Expanded card
  const [expandedBabysitter, setExpandedBabysitter] = useState<string | null>(null);

  // References for expanded babysitter
  interface RefInfo {
    text: string;
    refName: string;
    refEmail?: string;
    refPhone?: string;
    refWhatsapp?: string;
    isEjmFamily?: boolean;
    numberOfKids?: number;
    kidAges?: number[];
  }
  const [babysitterRefs, setBabysitterRefs] = useState<Record<string, RefInfo[]>>({});
  const [expandedRefIds, setExpandedRefIds] = useState<Set<string>>(new Set());

  const loadRefs = async (uid: string) => {
    if (babysitterRefs[uid]) return; // already loaded
    try {
      const snap = await getDocs(
        query(
          collection(db, 'references'),
          where('babysitterUserId', '==', uid),
          where('status', 'in', ['approved', 'published']),
          limit(10)
        )
      );
      const refs: RefInfo[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          text: data.referenceText || data.note || '',
          refName: data.submittedByName || data.refName || '',
          refEmail: data.refEmail || undefined,
          refPhone: data.refPhone || undefined,
          refWhatsapp: data.refWhatsapp || undefined,
          isEjmFamily: data.isEjmFamily || false,
          numberOfKids: data.numberOfKids || undefined,
          kidAges: data.kidAges || undefined,
        };
      });
      setBabysitterRefs((prev) => ({ ...prev, [uid]: refs }));
    } catch { /* silent */ }
  };

  // Contact dialog
  const [contactTarget, setContactTarget] = useState<BabysitterSummary | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Returning babysitter IDs (had confirmed appointment with this family)
  const [returningIds, setReturningIds] = useState<Set<string>>(new Set());

  // Preferred babysitter IDs
  const [preferredIds, setPreferredIds] = useState<Set<string>>(new Set());

  // ── Published searches (issue #207) ──
  const toast = useToast();
  const [myPublished, setMyPublished] = useState<OwnPublishedSearch[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<'cap' | 'generic' | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<OwnPublishedSearch | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const togglePreferred = (babysitterUid: string) => {
    const isPref = preferredIds.has(babysitterUid);
    // Optimistic UI update
    setPreferredIds((prev) => {
      const next = new Set(prev);
      if (isPref) next.delete(babysitterUid);
      else next.add(babysitterUid);
      return next;
    });
    setResults((prev) => prev.map((r) => r.uid === babysitterUid ? { ...r, isPreferred: !isPref } : r));
    // Debounced backend call (3s delay, cancels if toggled back)
    debouncedTogglePreferred(babysitterUid, !isPref);
  };

  // Load family + kids + returning babysitters
  useEffect(() => {
    if (!parent?.familyId) return;
    async function load() {
      const fSnap = await getDoc(doc(db, 'families', parent!.familyId));
      if (fSnap.exists()) {
        const f = fSnap.data() as FamilyDoc;
        setFamily(f);
        setAddress(f.address || '');
        setLatLng(f.latLng || null);
        setPreferredIds(new Set(f.preferredBabysitters || []));
        if (f.searchDefaults) {
          if (f.searchDefaults.maxRate) setOfferedRate(f.searchDefaults.maxRate);
          if (f.searchDefaults.minBabysitterAge) setFilterMinAge(f.searchDefaults.minBabysitterAge);
          if (f.searchDefaults.preferredGender) setFilterGender(f.searchDefaults.preferredGender);
          if (f.searchDefaults.requireReferences) setFilterRequireRefs(true);
        }
      }
      const kSnap = await getDocs(collection(db, 'families', parent!.familyId, 'kids'));
      setKids(kSnap.docs.map((d) => ({ ...(d.data() as KidDoc), kidId: d.id, selected: true })));

      // Load returning babysitter IDs
      try {
        const confirmedSnap = await getDocs(
          query(collection(db, 'appointments'), where('familyId', '==', parent!.familyId), where('status', '==', 'confirmed'))
        );
        const ids = new Set(confirmedSnap.docs.map((d) => d.data().babysitterUserId as string));
        setReturningIds(ids);
      } catch { /* ignore */ }
    }
    load();
  }, [parent]);

  const { periods: holidayPeriods } = useHolidays();
  const selectedKids = kids.filter((k) => k.selected);
  const today = new Date().toISOString().split('T')[0];
  const dateTag = getDateTag(date, startTime, holidayPeriods);

  // Live list of the family's own active sit published searches. Two equality
  // filters (no composite index needed); newest-first sort and the expiry
  // filter run client-side. A failed subscription just hides the section.
  useEffect(() => {
    if (!parent?.familyId) return;
    const q = query(
      collection(db, 'publishedSearches'),
      where('familyId', '==', parent.familyId),
      where('app', '==', 'sit'),
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
  }, [parent?.familyId]);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const enabledSlots = recurringSlots.filter((s) => s.enabled).map(({ day, startTime, endTime }) => ({ day, startTime, endTime }));
      const publishFn = httpsCallable(functions, 'publishSearch');
      await publishFn({
        type: searchType,
        date: searchType === 'one_time' ? date : undefined,
        startTime: searchType === 'one_time' ? startTime : undefined,
        endTime: searchType === 'one_time' ? endTime : undefined,
        recurringSlots: searchType === 'recurring' ? enabledSlots : undefined,
        schoolWeeksOnly: searchType === 'recurring' ? schoolWeeksOnly : undefined,
        kidIds: selectedKids.map((k) => k.kidId),
        offeredRate: offeredRate || undefined,
        additionalInfo: additionalInfo.trim() || undefined,
      });
      setPublishOpen(false);
      toast(t('publish.published'));
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
      toast(t('publish.withdrawn'));
    } catch {
      // Keep the dialog open and say so — a swallowed rules denial or offline
      // failure left the row visibly present but the dialog claimed success
      // (PR #210 review).
      toast(t('publish.withdrawError'));
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const searchFn = httpsCallable(functions, 'searchBabysitters');
      const enabledSlots = recurringSlots.filter((s) => s.enabled).map(({ day, startTime, endTime }) => ({ day, startTime, endTime }));
      const result = await searchFn({
        type: searchType,
        date: searchType === 'one_time' ? date : undefined,
        startTime: searchType === 'one_time' ? startTime : undefined,
        endTime: searchType === 'one_time' ? endTime : undefined,
        recurringSlots: searchType === 'recurring' ? enabledSlots : undefined,
        kidAges: selectedKids.map((k) => k.age),
        numberOfKids: selectedKids.length,
        latLng: latLng || { lat: 48.8566, lng: 2.3522 },
        offeredRate: offeredRate || undefined,
        filters: {
          minAge: filterMinAge,
          gender: filterGender !== 'any' ? filterGender : undefined,
          requireReferences: filterRequireRefs || undefined,
        },
      });
      setResults((result.data as { results: BabysitterSummary[] }).results);
      setStep('results');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setSearchError(message);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async () => {
    if (!contactTarget || !parent?.familyId) return;
    setSending(true);
    try {
      const enabledSlots = recurringSlots.filter((s) => s.enabled).map(({ day, startTime, endTime }) => ({ day, startTime, endTime }));
      const sendFn = httpsCallable(functions, 'sendContactRequest');
      await sendFn({
        babysitterUserId: contactTarget.uid,
        searchType,
        date: searchType === 'one_time' ? date : undefined,
        startTime: searchType === 'one_time' ? startTime : undefined,
        endTime: searchType === 'one_time' ? endTime : undefined,
        recurringSlots: searchType === 'recurring' ? enabledSlots : undefined,
        schoolWeeksOnly: searchType === 'recurring' ? schoolWeeksOnly : undefined,
        kidIds: selectedKids.map((k) => k.kidId),
        address,
        latLng: latLng || { lat: 48.8566, lng: 2.3522 },
        offeredRate: offeredRate || undefined,
        message: (message || additionalInfo).trim() || undefined,
        familyId: parent.familyId,
      });
      setSent(true);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send request';
      setSearchError(errorMessage);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <TopNav
        title={t('search.findBabysitter')}
        backTo={step === 'type' ? '/family' : undefined}
        onBack={step !== 'type' ? () => setStep(step === 'results' ? 'details' : 'type') : undefined}
      />

      {_family && !_family.verification?.isFullyVerified ? (
      <div className="px-5 pt-4 pb-8">
        <div className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <ShieldIcon className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-900">{t('verification.required')}</h2>
          <p className="mb-6 max-w-sm text-sm leading-relaxed text-gray-500">
            {t('search.verificationRequired')}
          </p>
          <Link to="/family/verification">
            <Button>{t('verification.completeVerification')}</Button>
          </Link>
        </div>
      </div>
      ) : (<>
      <div className="px-5 pt-4 pb-8">
        {/* Step 1: Type selection */}
        {step === 'type' && (
          <>
            <h2 className="mb-2 text-xl font-bold">{t('search.whatType')}</h2>
            <p className="mb-6 text-sm text-gray-500">{t('search.chooseType')}</p>

            <Card
              interactive
              className="mb-3"
              onClick={() => { setSearchType('one_time'); setStep('details'); }}
            >
              <p className="text-base font-semibold">{t('search.oneTime')}</p>
              <p className="text-sm text-gray-500">{t('search.oneTimeDesc')}</p>
            </Card>

            <Card
              interactive
              onClick={() => { setSearchType('recurring'); setStep('details'); }}
            >
              <p className="text-base font-semibold">{t('search.recurring')}</p>
              <p className="text-sm text-gray-500">{t('search.recurringDesc')}</p>
            </Card>

            {/* The family's own active published searches (issue #207) */}
            {myPublished.length > 0 && (
              <div className="mt-8">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('publish.myPublished')}</h3>
                {myPublished.map((p) => (
                  <Card key={p.id} className="mb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {p.type === 'one_time' && p.date
                            ? `${new Date(p.date + 'T00:00:00').toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}, ${p.startTime}–${p.endTime}`
                            : t('publish.recurringLabel', { count: p.recurringSlots?.length ?? 0 })}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t('publish.expiresOn', {
                            date: p.expiresAt.toDate().toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long' }),
                          })}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" fullWidth={false} className="shrink-0" onClick={() => setWithdrawTarget(p)}>
                        {t('publish.withdraw')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 2: Search details */}
        {step === 'details' && (
          <>
            <h2 className="mb-4 text-xl font-bold">
              {searchType === 'one_time' ? t('search.oneTimeTitle') : t('search.recurringTitle')}
            </h2>

            {searchType === 'one_time' && (
              <>
                <Input label={t('search.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today} error={date && date < today ? t('search.pastDateError') : undefined} required />
                {dateTag && <DateTag tag={dateTag} className="mt-1" />}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Select label={t('search.startTime')} value={startTime} onChange={(e) => setStartTime(e.target.value)} options={TIME_OPTIONS} />
                  </div>
                  <div className="flex-1">
                    <Select label={t('search.endTime')} value={endTime} onChange={(e) => setEndTime(e.target.value)} options={TIME_OPTIONS} />
                  </div>
                </div>
              </>
            )}

            {searchType === 'recurring' && (
              <>
                <div className="mb-5">
                  <label className="mb-2 block text-sm font-medium text-gray-700">{t('search.daysAndTimes')}</label>
                  <div className="space-y-2">
                    {recurringSlots.map((slot, i) => {
                      const dayLabels: Record<string, string> = { mon: t('days.mon'), tue: t('days.tue'), wed: t('days.wed'), thu: t('days.thu'), fri: t('days.fri'), sat: t('days.sat'), sun: t('days.sun') };
                      return (
                        <div key={slot.day} className={`rounded-lg border-[1.5px] p-3 transition-colors ${slot.enabled ? 'border-brand-200 bg-brand-50/50' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...recurringSlots];
                                updated[i] = { ...slot, enabled: !slot.enabled };
                                setRecurringSlots(updated);
                              }}
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-[1.5px] text-xs ${
                                slot.enabled ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'
                              }`}
                            >
                              {slot.enabled && '✓'}
                            </button>
                            <span className="w-10 text-sm font-medium">{dayLabels[slot.day]}</span>
                            {slot.enabled && (
                              <div className="flex flex-1 items-center gap-2">
                                <select
                                  value={slot.startTime}
                                  onChange={(e) => {
                                    const updated = [...recurringSlots];
                                    updated[i] = { ...slot, startTime: e.target.value };
                                    setRecurringSlots(updated);
                                  }}
                                  className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm"
                                >
                                  {TIME_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                <span className="text-xs text-gray-500">to</span>
                                <select
                                  value={slot.endTime}
                                  onChange={(e) => {
                                    const updated = [...recurringSlots];
                                    updated[i] = { ...slot, endTime: e.target.value };
                                    setRecurringSlots(updated);
                                  }}
                                  className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm"
                                >
                                  {TIME_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mb-5">
                  <label className="mb-2 block text-sm font-medium text-gray-700">{t('search.duringHolidays')}</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSchoolWeeksOnly(true)}
                      className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                        schoolWeeksOnly ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-gray-300 text-gray-700'
                      }`}
                    >
                      {t('search.schoolWeeksOnly')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSchoolWeeksOnly(false)}
                      className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                        !schoolWeeksOnly ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-gray-300 text-gray-700'
                      }`}
                    >
                      {t('search.includingHolidays')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Kid selection */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium text-gray-700">{t('search.whichKids')}</label>
              <div className="flex flex-wrap gap-2">
                {kids.map((kid, i) => (
                  <Chip
                    key={kid.kidId}
                    selected={kid.selected}
                    onClick={() => {
                      const updated = [...kids];
                      updated[i] = { ...kid, selected: !kid.selected };
                      setKids(updated);
                    }}
                  >
                    {kid.firstName} ({kid.age})
                  </Chip>
                ))}
              </div>
            </div>

            {/* Address */}
            <AddressAutocomplete
              label={t('search.address')}
              value={address ? { fullAddress: address, street: '', city: '', postcode: '', lat: latLng?.lat || 0, lng: latLng?.lng || 0 } : null}
              onChange={(addr: AddressResult | null) => {
                setAddress(addr?.fullAddress || '');
                setLatLng(addr ? { lat: addr.lat, lng: addr.lng } : null);
              }}
            />

            <Input
              label={t('search.rateToPayLabel')}
              type="number"
              value={offeredRate || ''}
              onChange={(e) => setOfferedRate(e.target.value === '' ? 0 : parseFloat(e.target.value))}
              min={0}
              hint={t('search.rateHint')}
            />

            <Textarea
              label={t('search.additionalInfo')}
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              placeholder={t('search.additionalInfoPlaceholder')}
            />

            <hr className="my-5 border-gray-200" />

            {/* Filters */}
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('search.filters')}</h3>
            <div className="flex gap-3">
              <div className="flex-1">
                <Input label={t('search.minBabysitterAge')} type="number" value={filterMinAge || ''} onChange={(e) => setFilterMinAge(e.target.value === '' ? 0 : parseInt(e.target.value))} min={15} max={19} />
              </div>
              <div className="flex-1">
                <Select label={t('search.genderPreference')} value={filterGender} onChange={(e) => setFilterGender(e.target.value)} options={GENDER_OPTIONS} />
              </div>
            </div>

            <div className="mb-5">
              <Chip selected={filterRequireRefs} onClick={() => setFilterRequireRefs(!filterRequireRefs)}>
                {t('search.mustHaveRefs')}
              </Chip>
            </div>

            {searchError && <p className="mb-4 text-sm text-brand-600">{searchError}</p>}

            <Button
              onClick={handleSearch}
              disabled={searching || (searchType === 'one_time' && (!date || date < today)) || (searchType === 'recurring' && !recurringSlots.some((s) => s.enabled)) || selectedKids.length === 0}
            >
              {searching ? t('search.searching') : t('common.search')}
            </Button>
          </>
        )}

        {/* Step 3: Results */}
        {step === 'results' && (
          <>
            <h2 className="mb-1 text-xl font-bold">{t('search.results')} ({results.length})</h2>
            {searchType === 'one_time' && date && (
              <div className="mb-4">
                <p className="text-sm text-gray-500">
                  {new Date(date + 'T00:00:00').toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}, {startTime}–{endTime}
                </p>
                <DateTag tag={dateTag} className="mt-1" />
              </div>
            )}

            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">🔍</div>
                <h3 className="mb-2 text-lg font-semibold">{t('search.noResults')}</h3>
                <p className="mb-6 max-w-[260px] text-sm text-gray-500">
                  {t('search.noResultsDesc')}
                </p>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => setPublishOpen(true)}>
                    {t('publish.cta')}
                  </Button>
                  <Button variant="outline" onClick={() => setStep('details')}>
                    {t('search.editSearch')}
                  </Button>
                </div>
                <p className="mt-3 max-w-[280px] text-xs text-gray-500">{t('publish.ctaHint')}</p>
              </div>
            ) : (() => {
              const preferred = results.filter((r) => r.isPreferred);
              const others = results.filter((r) => !r.isPreferred);
              const renderCard = (b: BabysitterSummary) => {
                const isExpanded = expandedBabysitter === b.uid;
                return (
                <Card key={b.uid} className="mb-3 cursor-pointer" onClick={() => { const next = isExpanded ? null : b.uid; setExpandedBabysitter(next); if (next) loadRefs(b.uid); }}>
                  <div className="flex gap-3">
                    <Avatar initials={`${(b.firstName || '')[0] || ''}${(b.lastName || '')[0] || ''}`} src={b.photoUrl || undefined} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900">
                          {formatBabysitterName(b.firstName, b.lastName)}
                          {b.isPreferred && <span className="ml-1" title="Preferred">❤️</span>}
                          {returningIds.has(b.uid) && <span className="ml-1 text-blue-500" title="Returning babysitter">⭐</span>}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">{b.age} {t('familyDashboard.ageSuffix')}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePreferred(b.uid); }}
                            className="text-base"
                            title={b.isPreferred ? t('preferred.remove') : t('preferred.add')}
                          >
                            {b.isPreferred ? '❤️' : '🤍'}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">{t('familyDashboard.classLabel')} {b.classLevel}</p>
                      {b.languages && b.languages.length > 0 && <p className="text-xs text-gray-500">🗣 {b.languages.join(', ')}</p>}
                      {b.kidAgeRange && (
                        <p className="text-xs text-gray-500">
                          👶 {t('familyDashboard.agesRange', { min: b.kidAgeRange.min, max: b.kidAgeRange.max })}{t('familyDashboard.upToKids', { count: b.maxKids })}
                        </p>
                      )}
                      {(b.distance ?? 0) > 0 && (
                        <p className="text-xs text-gray-500">📍 {b.distance} km away</p>
                      )}
                      {(b.referenceCount ?? 0) > 0 && (
                        <p className="text-xs text-gray-500"><span className="text-green-600">✓</span> {b.referenceCount} endorsement{(b.referenceCount ?? 0) > 1 ? 's' : ''}</p>
                      )}
                      {b.aboutMe && (
                        <p className={`mt-1 text-xs text-gray-600 ${isExpanded ? '' : 'line-clamp-2'}`}>"{b.aboutMe}"</p>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                      {b.aboutMe && (
                        <p className="text-xs leading-relaxed text-gray-600">{b.aboutMe}</p>
                      )}
                      {babysitterRefs[b.uid]?.length > 0 && (
                        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="mb-2 text-xs font-semibold text-gray-700"><span className="text-green-600">✓</span> {t('references.title')} ({babysitterRefs[b.uid].length})</p>
                          {babysitterRefs[b.uid].map((ref, i) => {
                            const refKey = `${b.uid}-${i}`;
                            const refExpanded = expandedRefIds.has(refKey);
                            return (
                              <div key={i} className="mb-1.5 last:mb-0">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedRefIds((prev) => { const next = new Set(prev); if (refExpanded) next.delete(refKey); else next.add(refKey); return next; }); }}
                                  className="w-full text-left rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-white active:bg-white"
                                >
                                  {refExpanded ? '▾' : '▸'} {ref.refName ? `Endorsement from ${ref.refName}` : `Endorsement ${i + 1}`}
                                  {ref.isEjmFamily && <span className="ml-1.5 text-blue-600 font-normal">EJM Family</span>}
                                </button>
                                {refExpanded && (
                                  <div className="ml-4 mt-1 mb-2 space-y-1">
                                    {ref.text && <p className="text-xs text-gray-600 italic">"{ref.text}"</p>}
                                    {ref.refEmail && (
                                      <a href={`mailto:${ref.refEmail}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-brand-600">
                                        <span>📧</span> {ref.refEmail}
                                      </a>
                                    )}
                                    {ref.refPhone && (
                                      <a href={`tel:${ref.refPhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-brand-600">
                                        <span>📞</span> {ref.refPhone}
                                      </a>
                                    )}
                                    {ref.refWhatsapp && (
                                      <a href={`https://wa.me/${ref.refWhatsapp.replace(/[^\d+]/g, '').replace('+', '')}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-green-600">
                                        <span>💬</span> {ref.refWhatsapp !== ref.refPhone ? ref.refWhatsapp : 'WhatsApp'}
                                      </a>
                                    )}
                                    {ref.numberOfKids && ref.numberOfKids > 0 && (
                                      <p className="text-xs text-gray-500">
                                        👶 {ref.numberOfKids} {ref.numberOfKids === 1 ? 'child' : 'children'}
                                        {ref.kidAges?.length ? ` (ages ${ref.kidAges.join(', ')})` : ''}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <Button size="sm" onClick={(e) => { e.stopPropagation(); setContactTarget(b); }} className="mt-3">
                    {t('search.contact', { name: b.firstName })}
                  </Button>
                </Card>
                );
              };
              return (
                <>
                  {/* Publish CTA (issue #207): the option rides every result
                      set — the demand board reaches providers this filtered
                      list cannot. */}
                  <Card className="mb-4">
                    {/* Stacked, not flex-row: shared-ui Button is w-full and
                        appended width classes lose the Tailwind conflict, so a
                        row layout crushes the hint to one word per line. */}
                    <p className="mb-3 text-xs text-gray-600">{t('publish.ctaHint')}</p>
                    <Button size="sm" variant="outline" onClick={() => setPublishOpen(true)}>
                      {t('publish.cta')}
                    </Button>
                  </Card>
                  {preferred.length > 0 && (
                    <>
                      <h3 className="mb-2 mt-2 text-sm font-semibold text-brand-600">❤️ {t('search.preferredSection')} ({preferred.length})</h3>
                      {preferred.map(renderCard)}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      {preferred.length > 0 && (
                        <h3 className="mb-2 mt-4 text-sm font-semibold text-gray-700">{t('search.otherSection')} ({others.length})</h3>
                      )}
                      {others.map(renderCard)}
                    </>
                  )}
                </>
              );
            })()
            }
          </>
        )}
      </div>

      {/* Publish Confirmation Dialog (issue #207) */}
      {publishOpen && (
        <Dialog open onClose={() => { setPublishOpen(false); setPublishError(null); }}>
          <h3 className="mb-2 text-lg font-bold">{t('publish.confirmTitle')}</h3>
          <p className="mb-2 text-sm text-gray-600">{t('publish.confirmDesc')}</p>
          <p className="mb-2 text-sm text-gray-600">
            {searchType === 'one_time'
              ? t('publish.durationOneTime')
              : t('publish.durationRecurring')}
          </p>
          {additionalInfo.trim() && (
            <p className="mb-2 text-xs text-amber-600">{t('publish.infoVisibleWarning')}</p>
          )}
          {publishError && (
            <p className="mb-3 text-sm text-brand-600">
              {publishError === 'cap' ? t('publish.capError') : t('publish.error')}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button onClick={handlePublish} disabled={publishing} className="flex-1">
              {publishing ? t('publish.publishing') : t('publish.confirmCta')}
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
          <h3 className="mb-2 text-lg font-bold">{t('publish.withdrawTitle')}</h3>
          <p className="mb-4 text-sm text-gray-600">{t('publish.withdrawDesc')}</p>
          <div className="flex gap-2">
            <Button onClick={handleWithdraw} disabled={withdrawing} className="flex-1">
              {withdrawing ? t('publish.withdrawing') : t('publish.withdraw')}
            </Button>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      )}

      {/* Contact Confirmation Dialog */}
      {contactTarget && !sent && (
        <Dialog open onClose={() => setContactTarget(null)}>
          <h3 className="mb-2 text-lg font-bold">{t('search.contactConfirm', { name: contactTarget.firstName })}</h3>
          <p className="mb-4 text-sm text-gray-600">
            {t('search.contactDesc', { name: contactTarget.firstName })}
          </p>

          <Textarea
            label={t('search.message')}
            value={message || additionalInfo}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('search.messagePlaceholder')}
          />

          <Input
            label={t('search.rateOffered')}
            type="number"
            value={offeredRate || ''}
            onChange={(e) => setOfferedRate(e.target.value === '' ? 0 : parseFloat(e.target.value))}
            min={0}
          />

          {searchError && <p className="mb-3 text-sm text-brand-600">{searchError}</p>}

          <div className="flex gap-2">
            <Button onClick={handleSendRequest} disabled={sending} className="flex-1">
              {sending ? t('search.sendingRequest') : t('search.sendRequest')}
            </Button>
            <Button variant="ghost" onClick={() => setContactTarget(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      )}

      {/* Success Dialog */}
      {sent && (
        <Dialog open onClose={() => { setSent(false); setContactTarget(null); }}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
              <CheckIcon className="h-7 w-7 text-green-600" />
            </div>
            <h3 className="mb-2 text-lg font-bold">{t('search.requestSent')}</h3>
            <p className="mb-5 text-sm text-gray-600">
              {t('search.requestSentDesc', { name: contactTarget?.firstName })}
            </p>
            {contactTarget?.contactEmail && (
              <p className="mb-1 text-sm text-gray-600">📧 {contactTarget.contactEmail}</p>
            )}
            {contactTarget?.contactPhone && (
              <p className="mb-4 text-sm text-gray-600">📞 {contactTarget.contactPhone}</p>
            )}
            <div className="flex flex-col gap-2">
              <Button onClick={() => { setSent(false); setContactTarget(null); setMessage(''); }}>
                {t('search.continueSearching')}
              </Button>
              <Button variant="outline" onClick={() => navigate('/family')}>
                {t('search.backToDashboard')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      </>)}
    </div>
  );
}

