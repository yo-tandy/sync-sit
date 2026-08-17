import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import { ARRONDISSEMENTS, NEARBY_TOWNS, ALL_AREAS } from '@ejm/shared-core';
import type { AreaMode } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Input,
  Chip,
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
  // Arrondissement mode: multi-choice selection over the shared area
  // vocabulary (sit's "area I can babysit in" style, issue #167).
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
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
    setSelectedAreas(tutor.arrondissements ?? []);
    setAreaAddress(tutor.areaAddress ?? '');
    setAreaLatLng(tutor.areaLatLng ?? null);
    setRadiusKm(tutor.areaRadiusKm ?? '');
  }, [tutor]);

  const switchMode = (mode: AreaMode) => {
    setAreaMode(mode);
    setSuccess(false);
    setError(null);
  };

  const toggleArea = (area: string) => {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    );
    setSuccess(false);
    setError(null);
  };

  // Migration tolerance: free-text-era docs may hold values outside the
  // constant lists (e.g. '75016' instead of '16e'). Render them as extra
  // toggleable entries — seeded checked — so a save never silently drops
  // them; unchecking one before saving is an explicit removal. Derived from
  // the STORED doc (not the live selection) so an unchecked legacy chip stays
  // visible and can be re-checked.
  const legacyAreas = (tutor?.arrondissements ?? []).filter(
    (a) => !(ALL_AREAS as readonly string[]).includes(a),
  );

  // Requirement (issue #167): a tutor offering sessions that happen at the
  // family's location ('family_home'/'library' — anything not 'online' or
  // 'tutor_home') must have a usable coverage area, or search could never
  // legitimately surface them for those session types.
  const requiresArea = (tutor?.locationPrefs ?? []).some(
    (p) => p !== 'online' && p !== 'tutor_home',
  );

  const handleAddressChange = (addr: AddressResult | null) => {
    setAreaAddress(addr?.fullAddress ?? '');
    setAreaLatLng(addr ? { lat: addr.lat, lng: addr.lng } : null);
    setSuccess(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!uid) return;
    // Requirement gate first: it explains WHY an area is needed. This is UX
    // only — the trust boundary is searchTutors, which excludes tutors whose
    // coverage cannot serve a location-typed query.
    if (
      requiresArea &&
      ((areaMode === 'arrondissement' && selectedAreas.length === 0) ||
        (areaMode === 'distance' && !areaLatLng))
    ) {
      setError(t('tutor.area.errorAreaRequired'));
      setSuccess(false);
      return;
    }
    if (areaMode === 'distance' && !areaLatLng) {
      setError(t('tutor.area.errorNoAddress'));
      setSuccess(false);
      return;
    }
    // UX validation mirroring enrollment's ranges; the real bound lives in
    // firestore.rules (tutorNumericBoundsValid), since min/max attributes
    // never gate a plain onClick save and SDK writes bypass the UI entirely.
    // 0 would exclude the tutor from every distance search (searchTutors caps
    // at min(radius, family filter)); empty already means the 5 km default —
    // so the editor requires 1-50. Rules keep 0-50 for legacy enrollment docs.
    if (areaMode === 'distance' && radiusKm !== '' && (radiusKm < 1 || radiusKm > 50)) {
      setError(t('tutor.area.errorRadiusRange'));
      setSuccess(false);
      return;
    }
    // Both branches write ALL five area dot-paths so a mode switch clears the
    // other mode's fields to the exact values enrollment stores for them.
    const payload =
      areaMode === 'arrondissement'
        ? {
            'profiles.tutor.areaMode': 'arrondissement',
            'profiles.tutor.arrondissements': selectedAreas,
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
            {areaLatLng && (
              <p className="mb-4 rounded-lg bg-amber-100 p-3 text-sm text-amber-600">
                {t('tutor.area.modeSwitchNote')}
              </p>
            )}
            <p className="mb-2 text-xs text-gray-500">{t('tutor.area.arrondissements')}</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {ARRONDISSEMENTS.map((arr) => (
                <Chip key={arr} selected={selectedAreas.includes(arr)} onClick={() => toggleArea(arr)}>
                  {arr}
                </Chip>
              ))}
            </div>
            <p className="mb-2 text-xs text-gray-500">{t('tutor.area.nearbyTowns')}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {NEARBY_TOWNS.map((town) => (
                <Chip key={town} selected={selectedAreas.includes(town)} onClick={() => toggleArea(town)}>
                  {town}
                </Chip>
              ))}
            </div>
            {legacyAreas.length > 0 && (
              <>
                <p className="mb-2 text-xs text-gray-500">{t('tutor.area.legacyAreas')}</p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {legacyAreas.map((area) => (
                    <Chip key={area} selected={selectedAreas.includes(area)} onClick={() => toggleArea(area)}>
                      {area}
                    </Chip>
                  ))}
                </div>
              </>
            )}
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
              hint={t('tutor.area.radiusHint')}
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
