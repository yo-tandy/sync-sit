import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Textarea, Chip } from '@/components/ui';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import { PhoneInput } from '@/components/forms/PhoneInput';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { ARRONDISSEMENTS, NEARBY_TOWNS } from '@ejm/shared';
import type { BabysitterUser } from '@ejm/shared';

interface StepPreferencesProps {
  uid: string;
  onComplete: () => void;
}

export function StepPreferences({ uid, onComplete }: StepPreferencesProps) {
  const { t } = useTranslation();
  const { userDoc, refreshUserDoc } = useAuthStore();
  const babysitter = userDoc as BabysitterUser | null;

  const [languages, setLanguages] = useState<string[]>([]);
  const [kidAgeMin, setKidAgeMin] = useState<number | ''>('');
  const [kidAgeMax, setKidAgeMax] = useState<number | ''>('');
  const [maxKids, setMaxKids] = useState<number | ''>('');
  const [hourlyRate, setHourlyRate] = useState<number | ''>('');
  const [aboutMe, setAboutMe] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [areaMode, setAreaMode] = useState<'arrondissement' | 'distance'>('arrondissement');
  const [arrondissements, setArrondissements] = useState<string[]>([]);
  const [areaAddress, setAreaAddress] = useState('');
  const [areaLatLng, setAreaLatLng] = useState<{ lat: number; lng: number } | undefined>();
  const [areaRadiusKm, setAreaRadiusKm] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate from existing user doc if resuming
  useEffect(() => {
    if (!babysitter) return;
    if (babysitter.languages?.length) setLanguages(babysitter.languages);
    if (babysitter.kidAgeRange) { setKidAgeMin(babysitter.kidAgeRange.min); setKidAgeMax(babysitter.kidAgeRange.max); }
    if (babysitter.maxKids) setMaxKids(babysitter.maxKids);
    if (babysitter.hourlyRate) setHourlyRate(babysitter.hourlyRate);
    if (babysitter.aboutMe) setAboutMe(babysitter.aboutMe);
    if (babysitter.contactEmail) setContactEmail(babysitter.contactEmail);
    if (babysitter.contactPhone) setContactPhone(babysitter.contactPhone);
    if (babysitter.whatsapp) { setWhatsapp(babysitter.whatsapp); setWhatsappSameAsPhone(babysitter.whatsapp === babysitter.contactPhone); }
    if (babysitter.areaMode) setAreaMode(babysitter.areaMode);
    if (babysitter.arrondissements) setArrondissements(babysitter.arrondissements);
    if (babysitter.areaAddress) setAreaAddress(babysitter.areaAddress);
    if (babysitter.areaLatLng) setAreaLatLng(babysitter.areaLatLng);
    if (babysitter.areaRadiusKm) setAreaRadiusKm(babysitter.areaRadiusKm);
  }, [babysitter]);

  const toggleArea = (area: string) => {
    if (arrondissements.includes(area)) {
      setArrondissements(arrondissements.filter((a) => a !== area));
    } else {
      setArrondissements([...arrondissements, area]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        languages,
        kidAgeRange: kidAgeMin !== '' && kidAgeMax !== '' ? { min: kidAgeMin, max: kidAgeMax } : null,
        maxKids: maxKids || null,
        hourlyRate: hourlyRate || null,
        aboutMe: aboutMe || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        whatsapp: whatsappSameAsPhone ? (contactPhone || null) : (whatsapp || null),
        areaMode,
        arrondissements: areaMode === 'arrondissement' ? arrondissements : [],
        areaAddress: areaMode === 'distance' ? areaAddress : null,
        areaLatLng: areaMode === 'distance' ? areaLatLng : null,
        areaRadiusKm: areaMode === 'distance' ? areaRadiusKm : null,
        enrollmentComplete: true,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        enrollmentComplete: true,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      onComplete();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6">
      <h2 className="mt-6 mb-2 text-xl font-bold">{t('enrollment.step4Title')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.mutableFieldsDesc')}</p>

      {/* Languages */}
      <LanguagePicker selected={languages} onChange={setLanguages} />
      <p className="mb-4 -mt-3 text-xs text-gray-400">{t('enrollment.languagesHint')}</p>

      <hr className="my-5 border-gray-200" />

      {/* Kids preferences — 3 in a row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input label={t('enrollment.kidsAgeMin')} type="number" value={kidAgeMin} onChange={(e) => setKidAgeMin(e.target.value === '' ? '' : parseInt(e.target.value))} min={0} max={18} placeholder="e.g. 3" hint={t('enrollment.kidsAgeMinHint')} />
        </div>
        <div className="flex-1">
          <Input label={t('enrollment.kidsAgeMax')} type="number" value={kidAgeMax} onChange={(e) => setKidAgeMax(e.target.value === '' ? '' : parseInt(e.target.value))} min={0} max={18} placeholder="e.g. 12" hint={t('enrollment.kidsAgeMaxHint')} />
        </div>
        <div className="flex-1">
          <Input label={t('enrollment.maxKids')} type="number" value={maxKids} onChange={(e) => setMaxKids(e.target.value === '' ? '' : parseInt(e.target.value))} min={1} max={10} placeholder="e.g. 3" hint={t('enrollment.maxKidsHint')} />
        </div>
      </div>

      {/* Rate — separate line with hint */}
      <Input label={t('enrollment.rateLabel')} type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value === '' ? '' : parseFloat(e.target.value))} min={0} placeholder="e.g. 15" hint={t('enrollment.rateTooltip')} />

      <Textarea label={t('enrollment.aboutMe')} value={aboutMe} onChange={(e) => setAboutMe(e.target.value)} placeholder={t('enrollment.aboutMePlaceholder')} />

      <hr className="my-5 border-gray-200" />

      {/* Contact */}
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>
      <Input label={t('common.email')} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
      <PhoneInput label={t('account.phone')} value={contactPhone} onChange={(val) => { setContactPhone(val); if (whatsappSameAsPhone) setWhatsapp(val); }} />

      <div className="mb-5">
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
          <span>WhatsApp</span>
        </label>
        <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={whatsappSameAsPhone}
            onChange={(e) => {
              setWhatsappSameAsPhone(e.target.checked);
              if (e.target.checked) setWhatsapp(contactPhone);
              else setWhatsapp('');
            }}
            className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          {t('account.whatsappSameAsPhone')}
        </label>
        {!whatsappSameAsPhone && (
          <PhoneInput label="" value={whatsapp} onChange={setWhatsapp} />
        )}
      </div>

      <hr className="my-5 border-gray-200" />

      {/* Area */}
      <div className="mb-5">
        <label className="mb-4 block text-sm font-medium text-gray-700">{t('enrollment.areaLabel')}</label>
        <div className="mb-4 flex rounded-lg bg-gray-100 p-[3px]">
          <button type="button" onClick={() => setAreaMode('arrondissement')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${areaMode === 'arrondissement' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'}`}>
            {t('enrollment.byArea')}
          </button>
          <button type="button" onClick={() => setAreaMode('distance')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${areaMode === 'distance' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'}`}>
            {t('enrollment.byDistance')}
          </button>
        </div>
        {areaMode === 'arrondissement' ? (
          <div>
            <p className="mb-2 text-xs text-gray-400">{t('enrollment.arrondissements')}</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {ARRONDISSEMENTS.map((arr) => (
                <Chip key={arr} selected={arrondissements.includes(arr)} onClick={() => toggleArea(arr)}>{arr}</Chip>
              ))}
            </div>
            <p className="mb-2 text-xs text-gray-400">{t('enrollment.nearbyTowns')}</p>
            <div className="flex flex-wrap gap-2">
              {NEARBY_TOWNS.map((town) => (
                <Chip key={town} selected={arrondissements.includes(town)} onClick={() => toggleArea(town)}>{town}</Chip>
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
            <Input label={t('enrollment.maxDistance')} type="number" value={areaRadiusKm || ''} onChange={(e) => setAreaRadiusKm(e.target.value === '' ? 0 : parseFloat(e.target.value))} min={1} max={20} />
          </div>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-3 pb-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={saving}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
        >
          {t('enrollment.skipForNow')}
        </button>
      </div>
    </div>
  );
}
