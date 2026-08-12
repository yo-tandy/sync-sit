import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import type { AreaMode } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Input,
  InfoBanner,
  AddressAutocomplete,
  type AddressResult,
} from '@ejm/shared-ui';

/**
 * Area editor (issue #123). Un-freezes the enrollment-only area fields —
 * mode, arrondissements, address + coordinates, radius. Distance in family
 * search results is computed from areaLatLng, so this page is also the
 * self-service path for legacy pre-fix enrollees whose docs never got
 * coordinates (they sort last as "distance unknown" until they re-pick an
 * address here).
 *
 * Save mirrors enrollTutor's stored shape exactly: all five area fields are
 * written every time, with the fields irrelevant to the chosen mode nulled
 * (`?? null`) and arrondissements emptied (`?? []`) — never left dangling from
 * the previous mode. Dot-path updateDoc only; profiles.tutor is never
 * rewritten wholesale (server-owned siblings live there).
 */
export function AreaPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  const [areaMode, setAreaMode] = useState<AreaMode>('arrondissement');
  // Arrondissement mode: comma-separated free text (enrollment collects a
  // single value; stored docs may hold several).
  const [arrText, setArrText] = useState('');
  // Distance mode: address + coordinates come ONLY from an AddressAutocomplete
  // pick. Typing without picking fires onChange(null), clearing both — a save
  // can never fabricate coordinates the geocoder didn't return.
  const [areaAddress, setAreaAddress] = useState('');
  const [areaLatLng, setAreaLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tutor) return;
    setAreaMode(tutor.areaMode ?? 'arrondissement');
    setArrText((tutor.arrondissements ?? []).join(', '));
    setAreaAddress(tutor.areaAddress ?? '');
    setAreaLatLng(tutor.areaLatLng ?? null);
    setRadiusKm(tutor.areaRadiusKm ?? '');
  }, [tutor]);

  const switchMode = (mode: AreaMode) => {
    setAreaMode(mode);
    setSuccess(false);
    setError(null);
  };

  const handleAddressChange = (addr: AddressResult | null) => {
    setAreaAddress(addr?.fullAddress ?? '');
    setAreaLatLng(addr ? { lat: addr.lat, lng: addr.lng } : null);
    setSuccess(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!uid) return;
    if (areaMode === 'distance' && !areaLatLng) {
      setError(t('tutor.area.errorNoAddress'));
      setSuccess(false);
      return;
    }
    // JS bound checks are the trust boundary here (rules only guard WHICH
    // keys change): min/max attributes never gate a plain onClick save, and
    // areaRadiusKm caps every family's distance-search inclusion.
    if (areaMode === 'distance' && radiusKm !== '' && (radiusKm < 1 || radiusKm > 50)) {
      setError(t('tutor.area.errorRadiusRange'));
      setSuccess(false);
      return;
    }
    const arrList = arrText.split(',').map((v) => v.trim()).filter(Boolean);
    if (areaMode === 'arrondissement' && (arrList.length > 20 || arrList.some((v) => v.length > 12))) {
      setError(t('tutor.area.errorArrondissements'));
      setSuccess(false);
      return;
    }
    // Both branches write ALL five area dot-paths so a mode switch clears the
    // other mode's fields to the exact values enrollment stores for them.
    const payload =
      areaMode === 'arrondissement'
        ? {
            'profiles.tutor.areaMode': 'arrondissement',
            'profiles.tutor.arrondissements': arrList,
            'profiles.tutor.areaAddress': null,
            'profiles.tutor.areaLatLng': null,
            'profiles.tutor.areaRadiusKm': null,
          }
        : {
            'profiles.tutor.areaMode': 'distance',
            'profiles.tutor.arrondissements': [],
            'profiles.tutor.areaAddress': areaAddress,
            'profiles.tutor.areaLatLng': areaLatLng,
            'profiles.tutor.areaRadiusKm': radiusKm === '' ? null : radiusKm,
          };
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <TopNav title={t('tutor.area.title')} backTo="/tutor/account" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-5 text-sm text-gray-500">{t('tutor.area.help')}</p>

        {success && <InfoBanner className="mb-4">{t('tutor.area.saved')}</InfoBanner>}

        <div className="mb-4 flex rounded-lg bg-gray-100 p-[3px]">
          <button
            type="button"
            aria-pressed={areaMode === 'arrondissement'}
            onClick={() => switchMode('arrondissement')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              areaMode === 'arrondissement' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t('tutor.area.byArea')}
          </button>
          <button
            type="button"
            aria-pressed={areaMode === 'distance'}
            onClick={() => switchMode('distance')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              areaMode === 'distance' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t('tutor.area.byDistance')}
          </button>
        </div>

        {areaMode === 'arrondissement' ? (
          <>
            <Input
              label={t('tutor.area.arrondissements')}
              type="text"
              value={arrText}
              onChange={(e) => {
                setArrText(e.target.value);
                setSuccess(false);
              }}
              placeholder="e.g. 75016"
            />
            <p className="-mt-4 mb-4 text-xs text-gray-400">
              {t('tutor.area.arrondissementsHint')}
            </p>
          </>
        ) : (
          <>
            {/* Honest state for legacy pre-fix enrollees: no coordinates on
                the doc means no distance in search — say so, and how to fix. */}
            {!areaLatLng && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-900">{t('tutor.area.noLocationNote')}</p>
              </div>
            )}
            <AddressAutocomplete
              label={t('tutor.area.address')}
              value={
                areaAddress && areaLatLng
                  ? {
                      fullAddress: areaAddress,
                      street: '',
                      city: '',
                      postcode: '',
                      lat: areaLatLng.lat,
                      lng: areaLatLng.lng,
                    }
                  : null
              }
              onChange={handleAddressChange}
            />
            <Input
              label={t('tutor.area.radius')}
              type="number"
              value={radiusKm}
              onChange={(e) => {
                const v = e.target.value === '' ? '' : parseFloat(e.target.value);
                setRadiusKm(typeof v === 'number' && Number.isNaN(v) ? '' : v);
                setSuccess(false);
              }}
              min={1}
              max={50}
            />
          </>
        )}

        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving') : t('tutor.area.save')}
        </Button>
      </div>
    </div>
  );
}
