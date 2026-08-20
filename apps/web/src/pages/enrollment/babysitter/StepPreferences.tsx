import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Textarea, Chip } from '@/components/ui';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import { PhoneInput } from '@/components/forms/PhoneInput';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { ARRONDISSEMENTS, NEARBY_TOWNS } from '@ejm/sit-core';
import { getBabysitterView, getContact } from '@ejm/sit-core';

interface StepPreferencesProps {
  uid: string;
  onComplete: () => void;
}

export function StepPreferences({ uid, onComplete }: StepPreferencesProps) {
  const { t } = useTranslation();
  const { userDoc, refreshUserDoc } = useAuthStore();
  const babysitter = getBabysitterView(userDoc);

  // One-shot seeding guard for the WHOLE resume-prefill effect (PR #206
  // review): `babysitter` is a fresh derived object every render, so any
  // unguarded setter in it re-fires per keystroke and reverts what the user
  // types — first found on contact, identical for aboutMe/rate/maxKids/kid
  // ages/area fields.
  const seededRef = useRef(false);
  // Which channels the prefill actually SHOWED (from any level) — see the
  // seeding effect and rootContactWrite.
  const seededContactRef = useRef<Record<string, boolean>>({});

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
    if (seededRef.current) return;
    seededRef.current = true;
    if (babysitter.languages?.length) setLanguages(babysitter.languages);
    if (babysitter.kidAgeRange) { setKidAgeMin(babysitter.kidAgeRange.min); setKidAgeMax(babysitter.kidAgeRange.max); }
    if (babysitter.maxKids) setMaxKids(babysitter.maxKids);
    if (babysitter.hourlyRate) setHourlyRate(babysitter.hourlyRate);
    if (babysitter.aboutMe) setAboutMe(babysitter.aboutMe);
    // Contact resolves root ?? nested (issue #203): a crossApp arrival seeds
    // both copies, and the canonical root wins when they ever diverge.
    const contact = getContact(userDoc);
    // What the user is SHOWN is what a clear must be able to erase — even if
    // the value resolved from a nested copy on an un-backfilled doc. Keying
    // "cleared" off root-key presence alone would drop such a clear and let
    // getContact resurrect the other profile's copy (PR #206 review).
    seededContactRef.current = {
      contactEmail: !!contact.contactEmail,
      contactPhone: !!contact.contactPhone,
      whatsapp: !!contact.whatsapp,
    };
    if (contact.contactEmail) setContactEmail(contact.contactEmail);
    if (contact.contactPhone) setContactPhone(contact.contactPhone);
    if (contact.whatsapp) {
      setWhatsapp(contact.whatsapp);
      setWhatsappSameAsPhone(contact.whatsapp === contact.contactPhone);
    } else if ((userDoc as unknown as Record<string, unknown>).whatsapp !== undefined) {
      // CLEARED (root key present, empty) — not merely absent. The checkbox
      // defaults to checked, so leaving it alone here would write
      // whatsapp = contactPhone on save and republish a channel the user
      // deleted in the other app (PR #206 review; same guard as the two
      // Account pages).
      setWhatsappSameAsPhone(false);
    }
    if (babysitter.areaMode) setAreaMode(babysitter.areaMode);
    if (babysitter.arrondissements) setArrondissements(babysitter.arrondissements);
    if (babysitter.areaAddress) setAreaAddress(babysitter.areaAddress);
    if (babysitter.areaLatLng) setAreaLatLng(babysitter.areaLatLng);
    if (babysitter.areaRadiusKm) setAreaRadiusKm(babysitter.areaRadiusKm);
  }, [babysitter, userDoc]);

  const toggleArea = (area: string) => {
    if (arrondissements.includes(area)) {
      setArrondissements(arrondissements.filter((a) => a !== area));
    } else {
      setArrondissements([...arrondissements, area]);
    }
  };

  // Root contact write rule — see the call sites in the save payload.
  const rootContactWrite = (key: string, value: string): Record<string, string | null> => {
    if (value) return { [key]: value };
    // Empty now. Write an explicit null (a CLEAR) when the user had something
    // here — either stored at the root, or shown to them by the prefill from
    // a nested copy. Otherwise omit: never-supplied must stay ABSENT so the
    // nested fallback and the backfill still work.
    const rootRaw = userDoc as unknown as Record<string, unknown> | null | undefined;
    const wasShown = seededContactRef.current[key] === true;
    return rootRaw?.[key] !== undefined || wasShown ? { [key]: null } : {};
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.babysitter.languages': languages,
        'profiles.babysitter.kidAgeRange': { min: kidAgeMin !== '' ? kidAgeMin : null, max: kidAgeMax !== '' ? kidAgeMax : null },
        'profiles.babysitter.maxKids': maxKids || null,
        'profiles.babysitter.hourlyRate': hourlyRate || null,
        'profiles.babysitter.aboutMe': aboutMe || null,
        // Contact dual-writes root + nested (issue #203): this step IS an
        // enrollment writer, so it mints the canonical root copy like the
        // server callables do; the nested copy stays for back-compat readers.
        'profiles.babysitter.contactEmail': contactEmail || null,
        'profiles.babysitter.contactPhone': contactPhone || null,
        'profiles.babysitter.whatsapp': whatsappSameAsPhone ? (contactPhone || null) : (whatsapp || null),
        // Root copies follow the server writers' rule (PR #206 rounds 6-8):
        // a channel the user SUPPLIED is written; one they CLEARED (it was at
        // the root before) is written as null so the clear sticks; one they
        // never supplied is OMITTED, because root presence means "set or
        // cleared by the user" and a null would read as a deliberate clear.
        ...rootContactWrite('contactEmail', contactEmail),
        ...rootContactWrite('contactPhone', contactPhone),
        ...rootContactWrite('whatsapp', whatsappSameAsPhone ? contactPhone : whatsapp),
        'profiles.babysitter.areaMode': areaMode,
        'profiles.babysitter.arrondissements': areaMode === 'arrondissement' ? arrondissements : [],
        'profiles.babysitter.areaAddress': areaMode === 'distance' ? areaAddress : null,
        'profiles.babysitter.areaLatLng': areaMode === 'distance' ? areaLatLng : null,
        'profiles.babysitter.areaRadiusKm': areaMode === 'distance' ? areaRadiusKm : null,
        'profiles.babysitter.enrollmentComplete': true,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      onComplete();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.babysitter.enrollmentComplete': true,
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
      <p className="mb-4 -mt-3 text-xs text-gray-500">{t('enrollment.languagesHint')}</p>

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
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
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
            <p className="mb-2 text-xs text-gray-500">{t('enrollment.arrondissements')}</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {ARRONDISSEMENTS.map((arr) => (
                <Chip key={arr} selected={arrondissements.includes(arr)} onClick={() => toggleArea(arr)}>{arr}</Chip>
              ))}
            </div>
            <p className="mb-2 text-xs text-gray-500">{t('enrollment.nearbyTowns')}</p>
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

      {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

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
