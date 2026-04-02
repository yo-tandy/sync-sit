import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Textarea, Select, Chip, TopNav, InfoBanner } from '@/components/ui';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { ARRONDISSEMENTS, NEARBY_TOWNS } from '@ejm/shared';
import type { BabysitterUser } from '@ejm/shared';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function getGenderOptions(t: (key: string) => string) {
  return [
    { value: 'female', label: t('enrollment.genderFemale') },
    { value: 'male', label: t('enrollment.genderMale') },
    { value: 'other', label: t('enrollment.genderOther') },
    { value: 'prefer_not_to_say', label: t('enrollment.genderPreferNot') },
  ];
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const babysitter = userDoc as BabysitterUser | null;
  const uid = firebaseUser?.uid;

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [classLevel, setClassLevel] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [kidAgeMin, setKidAgeMin] = useState(3);
  const [kidAgeMax, setKidAgeMax] = useState(12);
  const [maxKids, setMaxKids] = useState(3);
  const [hourlyRate, setHourlyRate] = useState(15);
  const [aboutMe, setAboutMe] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [areaMode, setAreaMode] = useState<'arrondissement' | 'distance'>('arrondissement');
  const [arrondissements, setArrondissements] = useState<string[]>([]);
  const [areaAddress, setAreaAddress] = useState('');
  const [areaLatLng, setAreaLatLng] = useState<{ lat: number; lng: number } | undefined>();
  const [areaRadiusKm, setAreaRadiusKm] = useState(3);

  // Photo state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form from userDoc
  useEffect(() => {
    if (!babysitter) return;
    setFirstName(babysitter.firstName || '');
    setLastName(babysitter.lastName || '');
    // Handle both string "yyyy-MM-dd" and Firestore Timestamp formats
    const dob = babysitter.dateOfBirth;
    if (typeof dob === 'string') {
      setDateOfBirth(dob);
    } else if (dob && typeof (dob as any).toDate === 'function') {
      // Firestore Timestamp
      const d = (dob as any).toDate() as Date;
      setDateOfBirth(d.toISOString().split('T')[0]);
    } else {
      setDateOfBirth('');
    }
    setGender(babysitter.gender);
    setClassLevel(babysitter.classLevel || '');
    setLanguages(babysitter.languages || []);
    setKidAgeMin(babysitter.kidAgeRange?.min ?? 3);
    setKidAgeMax(babysitter.kidAgeRange?.max ?? 12);
    setMaxKids(babysitter.maxKids ?? 3);
    setHourlyRate(babysitter.hourlyRate ?? 15);
    setAboutMe(babysitter.aboutMe || '');
    setContactEmail(babysitter.contactEmail || '');
    setContactPhone(babysitter.contactPhone || '');
    setAreaMode(babysitter.areaMode || 'arrondissement');
    setArrondissements(babysitter.arrondissements || []);
    setAreaAddress(babysitter.areaAddress || '');
    setAreaLatLng(babysitter.areaLatLng);
    setAreaRadiusKm(babysitter.areaRadiusKm ?? 3);
    if (babysitter.photoUrl) {
      setPhotoPreview(babysitter.photoUrl);
    }
  }, [babysitter]);

  const handlePhotoSelect = (file: File) => {
    setPhotoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Please select a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPhotoError('Photo must be under 5 MB');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoSelect(file);
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setPhotoFile(null);
    setPhotoError(null);
  };

  const toggleArea = (area: string) => {
    if (arrondissements.includes(area)) {
      setArrondissements(arrondissements.filter((a) => a !== area));
    } else {
      setArrondissements([...arrondissements, area]);
    }
  };

  const hasContact = !!(contactEmail || contactPhone);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Upload photo if changed
      let photoUrl: string | null | undefined = undefined;
      if (photoFile) {
        try {
          const ext = photoFile.name.split('.').pop() || 'jpg';
          const path = `profile-photos/${uid}.${ext}`;
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, photoFile);
          photoUrl = await getDownloadURL(storageRef);
        } catch {
          // Storage emulator not running or bucket not configured — skip photo upload
          console.warn('Photo upload failed (storage may not be available). Saving other fields.');
        }
      } else if (!photoPreview && babysitter?.photoUrl) {
        photoUrl = null; // Photo removed
      }

      const updates: Record<string, unknown> = {
        gender: gender || null,
        classLevel,
        languages,
        kidAgeRange: { min: kidAgeMin, max: kidAgeMax },
        maxKids,
        hourlyRate,
        aboutMe: aboutMe || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        areaMode,
        arrondissements: areaMode === 'arrondissement' ? arrondissements : [],
        areaAddress: areaMode === 'distance' ? areaAddress : null,
        areaLatLng: areaMode === 'distance' ? areaLatLng : null,
        areaRadiusKm: areaMode === 'distance' ? areaRadiusKm : null,
        updatedAt: serverTimestamp(),
      };

      if (photoUrl !== undefined) {
        updates.photoUrl = photoUrl;
      }

      await updateDoc(doc(db, 'users', uid), updates);
      await refreshUserDoc();
      setPhotoFile(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <TopNav title={t('profile.title')} backTo="/babysitter" />

      <form onSubmit={handleSave} className="px-6 pt-4 pb-8">
        {success && <InfoBanner className="mb-4">{t('profile.saved')}</InfoBanner>}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {/* Photo */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <div>
            {photoPreview ? (
              <button type="button" onClick={handleRemovePhoto} className="text-sm font-medium text-red-600">
                {t('enrollment.removePhoto')}
              </button>
            ) : (
              <p className="text-sm font-medium">{t('enrollment.addPhoto')}</p>
            )}
            <p className="text-xs text-gray-400">{t('enrollment.photoOptional')}</p>
            {photoError && <p className="text-xs text-red-600">{photoError}</p>}
          </div>
        </div>

        {/* Names (read-only) */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input label={t('enrollment.firstName')} value={firstName} disabled className="bg-gray-50 text-gray-500" />
          </div>
          <div className="flex-1">
            <Input label={t('enrollment.lastName')} value={lastName} disabled className="bg-gray-50 text-gray-500" />
          </div>
        </div>

        {/* DOB (read-only) + Class */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input label={t('enrollment.dateOfBirth')} type="date" value={dateOfBirth} disabled className="bg-gray-50 text-gray-500" />
          </div>
          <div className="flex-1">
            <Select
              label={t('enrollment.classLabel')}
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              placeholder={t('enrollment.selectClass')}
              options={[
                { value: 'Terminale', label: 'Terminale' },
                { value: '1ère', label: '1ère' },
                { value: '2nde', label: '2nde' },
                { value: '3ème', label: '3ème' },
              ]}
              required
            />
          </div>
        </div>

        {/* Gender */}
        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.gender')}</label>
          <div className="flex gap-2">
            {getGenderOptions(t).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGender(gender === opt.value ? undefined : opt.value)}
                className={`flex-1 rounded-lg border-[1.5px] px-2 py-2 text-sm font-medium transition-colors ${
                  gender === opt.value
                    ? 'border-red-600 bg-red-50 text-red-600'
                    : 'border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Languages */}
        <LanguagePicker selected={languages} onChange={setLanguages} />

        <hr className="my-5 border-gray-200" />

        {/* Preferences */}
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

        <Textarea label={t('enrollment.aboutMe')} value={aboutMe} onChange={(e) => setAboutMe(e.target.value)} placeholder={t('enrollment.aboutMePlaceholder')} />

        <hr className="my-5 border-gray-200" />

        {/* Contact */}
        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.contactLabel')}</label>
          <Input placeholder={t('common.email')} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          <Input placeholder={t('common.phone')} type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          {!hasContact && <p className="text-sm text-red-600">{t('enrollment.contactError')}</p>}
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

        <Button type="submit" disabled={saving || !hasContact || !firstName || !lastName} className="mt-4">
          {saving ? t('common.saving') : t('profile.saveProfile')}
        </Button>
      </form>
    </div>
  );
}
