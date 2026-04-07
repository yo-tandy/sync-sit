import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Textarea, Chip, TopNav, InfoBanner } from '@/components/ui';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { ARRONDISSEMENTS, NEARBY_TOWNS } from '@ejm/shared';
import type { BabysitterUser } from '@ejm/shared';

export function BabysittingOptionsPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const babysitter = userDoc as BabysitterUser | null;
  const uid = firebaseUser?.uid;

  // Form state
  const [languages, setLanguages] = useState<string[]>([]);
  const [kidAgeMin, setKidAgeMin] = useState(3);
  const [kidAgeMax, setKidAgeMax] = useState(12);
  const [maxKids, setMaxKids] = useState(3);
  const [hourlyRate, setHourlyRate] = useState(15);
  const [areaMode, setAreaMode] = useState<'arrondissement' | 'distance'>('arrondissement');
  const [arrondissements, setArrondissements] = useState<string[]>([]);
  const [areaAddress, setAreaAddress] = useState('');
  const [areaLatLng, setAreaLatLng] = useState<{ lat: number; lng: number } | undefined>();
  const [areaRadiusKm, setAreaRadiusKm] = useState(3);
  const [aboutMe, setAboutMe] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from userDoc
  useEffect(() => {
    if (!babysitter) return;
    setLanguages(babysitter.languages || []);
    setKidAgeMin(babysitter.kidAgeRange?.min ?? 3);
    setKidAgeMax(babysitter.kidAgeRange?.max ?? 12);
    setMaxKids(babysitter.maxKids ?? 3);
    setHourlyRate(babysitter.hourlyRate ?? 15);
    setAreaMode(babysitter.areaMode || 'arrondissement');
    setArrondissements(babysitter.arrondissements || []);
    setAreaAddress(babysitter.areaAddress || '');
    setAreaLatLng(babysitter.areaLatLng);
    setAreaRadiusKm(babysitter.areaRadiusKm ?? 3);
    setAboutMe(babysitter.aboutMe || '');
  }, [babysitter]);

  const toggleArea = (area: string) => {
    if (arrondissements.includes(area)) {
      setArrondissements(arrondissements.filter((a) => a !== area));
    } else {
      setArrondissements([...arrondissements, area]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updateDoc(doc(db, 'users', uid), {
        aboutMe: aboutMe || null,
        languages,
        kidAgeRange: { min: kidAgeMin, max: kidAgeMax },
        maxKids,
        hourlyRate,
        areaMode,
        arrondissements: areaMode === 'arrondissement' ? arrondissements : [],
        areaAddress: areaMode === 'distance' ? areaAddress : null,
        areaLatLng: areaMode === 'distance' ? areaLatLng : null,
        areaRadiusKm: areaMode === 'distance' ? areaRadiusKm : null,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <TopNav title={t('menu.babysittingOptions')} backTo="/babysitter" />

      <form onSubmit={handleSave} className="px-5 pt-4 pb-8">
        {success && <InfoBanner className="mb-4">{t('profile.saved')}</InfoBanner>}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {/* About Me */}
        <Textarea
          label={t('enrollment.aboutMe')}
          value={aboutMe}
          onChange={(e) => setAboutMe(e.target.value)}
          placeholder={t('enrollment.aboutMePlaceholder')}
        />

        <hr className="my-5 border-gray-200" />

        {/* Languages */}
        <LanguagePicker selected={languages} onChange={setLanguages} />

        <hr className="my-5 border-gray-200" />

        {/* Kids Preferences */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('profile.babysittingPreferences')}</h3>

        <div className="flex gap-3">
          <div className="flex-1">
            <Input label={t('enrollment.kidsAgeMin')} type="number" value={kidAgeMin || ''} onChange={(e) => setKidAgeMin(e.target.value === '' ? 0 : parseInt(e.target.value))} min={0} max={18} />
          </div>
          <div className="flex-1">
            <Input label={t('enrollment.kidsAgeMax')} type="number" value={kidAgeMax || ''} onChange={(e) => setKidAgeMax(e.target.value === '' ? 0 : parseInt(e.target.value))} min={0} max={18} />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Input label={t('enrollment.maxKids')} type="number" value={maxKids || ''} onChange={(e) => setMaxKids(e.target.value === '' ? 0 : parseInt(e.target.value))} min={1} max={10} />
          </div>
          <div className="flex-1">
            <Input label={t('enrollment.rateLabel')} type="number" value={hourlyRate || ''} onChange={(e) => setHourlyRate(e.target.value === '' ? 0 : parseFloat(e.target.value))} min={0} />
          </div>
        </div>

        <hr className="my-5 border-gray-200" />

        {/* Area */}
        <div className="mb-5">
          <label className="mb-4 block text-sm font-medium text-gray-700">{t('enrollment.areaLabel')}</label>

          <div className="mb-4 flex rounded-lg bg-gray-100 p-[3px]">
            <button
              type="button"
              onClick={() => setAreaMode('arrondissement')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                areaMode === 'arrondissement' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t('enrollment.byArea')}
            </button>
            <button
              type="button"
              onClick={() => setAreaMode('distance')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                areaMode === 'distance' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t('enrollment.byDistance')}
            </button>
          </div>

          {areaMode === 'arrondissement' ? (
            <div>
              <p className="mb-2 text-xs text-gray-400">{t('enrollment.arrondissements')}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {ARRONDISSEMENTS.map((arr) => (
                  <Chip key={arr} selected={arrondissements.includes(arr)} onClick={() => toggleArea(arr)}>
                    {arr}
                  </Chip>
                ))}
              </div>
              <p className="mb-2 text-xs text-gray-400">{t('enrollment.nearbyTowns')}</p>
              <div className="flex flex-wrap gap-2">
                {NEARBY_TOWNS.map((town) => (
                  <Chip key={town} selected={arrondissements.includes(town)} onClick={() => toggleArea(town)}>
                    {town}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <AddressAutocomplete
                label={t('enrollment.yourAddress')}
                value={areaAddress ? { fullAddress: areaAddress, street: '', city: '', postcode: '', lat: areaLatLng?.lat || 0, lng: areaLatLng?.lng || 0 } : null}
                onChange={(addr: AddressResult | null) => {
                  setAreaAddress(addr?.fullAddress || '');
                  setAreaLatLng(addr ? { lat: addr.lat, lng: addr.lng } : undefined);
                }}
              />
              <Input
                label={t('enrollment.maxDistance')}
                type="number"
                value={areaRadiusKm || ''}
                onChange={(e) => setAreaRadiusKm(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                min={1}
                max={20}
              />
            </div>
          )}
        </div>

        <Button type="submit" disabled={saving} className="mt-4">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </form>
    </div>
  );
}
