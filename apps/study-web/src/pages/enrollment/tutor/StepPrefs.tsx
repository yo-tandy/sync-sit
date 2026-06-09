import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface PrefsData {
  sessionLengthsMin: number[];
  locationPrefs: string[];
  paddingMin: number;
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  areaMode: 'arrondissement' | 'distance';
  arrondissements?: string[];
  areaAddress?: string;
  areaRadiusKm?: number;
}

interface StepPrefsProps {
  onNext: (data: PrefsData) => void;
  loading: boolean;
  error: string | null;
}

const SESSION_LENGTHS = [30, 45, 60, 75] as const;

const LOCATION_PREFS = [
  { value: 'family_home', label: "At family's home" },
  { value: 'tutor_home', label: "At tutor's home" },
  { value: 'online', label: 'Online' },
  { value: 'library', label: 'Library / public space' },
] as const;

export function StepPrefs({ onNext, loading, error }: StepPrefsProps) {
  const { t } = useTranslation();
  const [sessionLengths, setSessionLengths] = useState<number[]>([]);
  const [locationPrefs, setLocationPrefs] = useState<string[]>([]);
  const [paddingMin, setPaddingMin] = useState<number>(0);
  const [aboutMe, setAboutMe] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [areaMode, setAreaMode] = useState<'arrondissement' | 'distance'>('arrondissement');
  const [city, setCity] = useState('');

  const toggleSessionLength = (len: number) => {
    setSessionLengths((prev) =>
      prev.includes(len) ? prev.filter((l) => l !== len) : [...prev, len]
    );
  };

  const toggleLocationPref = (pref: string) => {
    setLocationPrefs((prev) =>
      prev.includes(pref) ? prev.filter((l) => l !== pref) : [...prev, pref]
    );
  };

  const hasContact = contactEmail.trim() || contactPhone.trim();
  const isValid = sessionLengths.length > 0 && locationPrefs.length > 0 && hasContact;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext({
      sessionLengthsMin: sessionLengths,
      locationPrefs,
      paddingMin,
      aboutMe: aboutMe || undefined,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
      areaMode,
      arrondissements: areaMode === 'arrondissement' && city ? [city] : undefined,
      areaAddress: areaMode === 'distance' && city ? city : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.sessionPrefsTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.sessionPrefsSubtitle')}</p>

      {/* Session lengths */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.sessionLengths')}</label>
        <div className="flex flex-wrap gap-2">
          {SESSION_LENGTHS.map((len) => (
            <button
              key={len}
              type="button"
              onClick={() => toggleSessionLength(len)}
              className={`rounded-lg border-[1.5px] px-4 py-2 text-sm font-medium transition-colors ${
                sessionLengths.includes(len)
                  ? 'border-red-600 bg-red-50 text-red-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {len} min
            </button>
          ))}
        </div>
      </div>

      {/* Location prefs */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.locationPrefs')}</label>
        <div className="flex flex-col gap-2">
          {LOCATION_PREFS.map((pref) => (
            <label key={pref.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={locationPrefs.includes(pref.value)}
                onChange={() => toggleLocationPref(pref.value)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {pref.label}
            </label>
          ))}
        </div>
      </div>

      {/* Padding */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.paddingMin')}</label>
        <input
          type="number"
          value={paddingMin}
          onChange={(e) => setPaddingMin(parseInt(e.target.value) || 0)}
          min={0}
          max={60}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
        />
        <p className="mt-1 text-xs text-gray-400">{t('enrollment.paddingMinHint')}</p>
      </div>

      {/* About me */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('enrollment.aboutMe')} <span className="text-gray-400">({t('common.optional')})</span>
        </label>
        <textarea
          value={aboutMe}
          onChange={(e) => setAboutMe(e.target.value)}
          placeholder={t('enrollment.aboutMePlaceholder')}
          rows={4}
          maxLength={1000}
          className="w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 py-3 text-base outline-none transition-colors focus:border-red-600"
        />
      </div>

      <hr className="my-5 border-gray-200" />

      {/* Contact */}
      <p className="mb-3 text-sm font-semibold text-gray-700">Contact (at least one required)</p>
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.contactEmail')}</label>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
        />
      </div>
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.contactPhone')}</label>
        <input
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
        />
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
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {areaMode === 'arrondissement' ? t('enrollment.arrondissements') : t('enrollment.yourAddress')}
        </label>
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={areaMode === 'arrondissement' ? 'e.g. 75016' : 'e.g. 16 rue de Passy, Paris'}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 pb-6">
        <button
          type="submit"
          disabled={!isValid || loading}
          className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('enrollment.tutor.stepPrefs')}
        </button>
      </div>
    </form>
  );
}
