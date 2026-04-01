import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  Button, Card, Input, Select, Textarea, Chip, TopNav, Dialog, Avatar,
} from '@/components/ui';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { formatBabysitterName } from '@/lib/formatName';
import { CheckIcon } from '@/components/ui/Icons';
import type { ParentUser, FamilyDoc, KidDoc, SearchDefaults } from '@ejm/shared';

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

interface BabysitterResult {
  uid: string;
  firstName: string;
  lastName: string;
  age: number;
  classLevel: string;
  languages: string[];
  photoUrl: string | null;
  aboutMe: string | null;
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;
  distance: number;
  referenceCount: number;
  contactEmail?: string;
  contactPhone?: string;
}

export function SearchPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const parent = userDoc as ParentUser | null;
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
  const [_defaults, setDefaults] = useState<SearchDefaults>({});

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
  const [results, setResults] = useState<BabysitterResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Contact dialog
  const [contactTarget, setContactTarget] = useState<BabysitterResult | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Returning babysitter IDs (had confirmed appointment with this family)
  const [returningIds, setReturningIds] = useState<Set<string>>(new Set());

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
        if (f.searchDefaults) {
          setDefaults(f.searchDefaults);
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

  const selectedKids = kids.filter((k) => k.selected);
  const today = new Date().toISOString().split('T')[0];

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
      setResults((result.data as { results: BabysitterResult[] }).results);
      setStep('results');
    } catch (err: any) {
      setSearchError(err.message || 'Search failed');
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
    } catch (err: any) {
      setSearchError(err.message || 'Failed to send request');
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
                <Input label={t('search.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today} required />
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
                        <div key={slot.day} className={`rounded-lg border-[1.5px] p-3 transition-colors ${slot.enabled ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...recurringSlots];
                                updated[i] = { ...slot, enabled: !slot.enabled };
                                setRecurringSlots(updated);
                              }}
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-[1.5px] text-xs ${
                                slot.enabled ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300'
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
                                <span className="text-xs text-gray-400">to</span>
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
                        schoolWeeksOnly ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-300 text-gray-700'
                      }`}
                    >
                      {t('search.schoolWeeksOnly')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSchoolWeeksOnly(false)}
                      className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                        !schoolWeeksOnly ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-300 text-gray-700'
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
              value={offeredRate}
              onChange={(e) => setOfferedRate(parseFloat(e.target.value) || 0)}
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
                <Input label={t('search.minBabysitterAge')} type="number" value={filterMinAge} onChange={(e) => setFilterMinAge(parseInt(e.target.value) || 15)} min={15} max={19} />
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

            {searchError && <p className="mb-4 text-sm text-red-600">{searchError}</p>}

            <Button
              onClick={handleSearch}
              disabled={searching || (searchType === 'one_time' && !date) || (searchType === 'recurring' && !recurringSlots.some((s) => s.enabled)) || selectedKids.length === 0}
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
              <p className="mb-4 text-sm text-gray-500">
                {new Date(date + 'T00:00:00').toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}, {startTime}–{endTime}
              </p>
            )}

            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">🔍</div>
                <h3 className="mb-2 text-lg font-semibold">{t('search.noResults')}</h3>
                <p className="mb-6 max-w-[260px] text-sm text-gray-500">
                  {t('search.noResultsDesc')}
                </p>
                <Button variant="outline" onClick={() => setStep('details')}>
                  {t('search.editSearch')}
                </Button>
              </div>
            ) : (
              results.map((b) => (
                <Card key={b.uid} className="mb-3">
                  <div className="flex gap-3">
                    <Avatar initials={`${(b.firstName || '')[0] || ''}${(b.lastName || '')[0] || ''}`} src={b.photoUrl || undefined} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900">
                          {formatBabysitterName(b.firstName, b.lastName)}
                          {returningIds.has(b.uid) && <span className="ml-1 text-blue-500" title="Returning babysitter">⭐</span>}
                        </p>
                        <span className="text-sm text-gray-500">{b.age} {t('familyDashboard.ageSuffix')}</span>
                      </div>
                      <p className="text-xs text-gray-500">{t('familyDashboard.classLabel')} {b.classLevel}</p>
                      <p className="text-xs text-gray-500">🗣 {b.languages.join(', ')}</p>
                      <p className="text-xs text-gray-500">
                        👶 {t('familyDashboard.agesRange', { min: b.kidAgeRange.min, max: b.kidAgeRange.max })}{t('familyDashboard.upToKids', { count: b.maxKids })}
                      </p>
                      {b.distance > 0 && (
                        <p className="text-xs text-gray-500">📍 {b.distance} km away</p>
                      )}
                      {b.referenceCount > 0 && (
                        <p className="text-xs text-gray-500">⭐ {b.referenceCount} reference{b.referenceCount > 1 ? 's' : ''}</p>
                      )}
                      {b.aboutMe && (
                        <p className="mt-1 text-xs text-gray-600 line-clamp-2">"{b.aboutMe}"</p>
                      )}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setContactTarget(b)} className="mt-3">
                    {t('search.contact', { name: b.firstName })}
                  </Button>
                </Card>
              ))
            )}
          </>
        )}
      </div>

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
            value={offeredRate}
            onChange={(e) => setOfferedRate(parseFloat(e.target.value) || 0)}
            min={0}
          />

          {searchError && <p className="mb-3 text-sm text-red-600">{searchError}</p>}

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
    </div>
  );
}
