import { useState, useEffect, useRef } from 'react';
import { CoParentSection } from '@/components/family/CoParentSection';
import { useTranslation } from 'react-i18next';
import {
  doc,
  collection,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import type { FamilyDoc, KidDoc } from '@ejm/shared-core';
import {
  Button,
  Input,
  Textarea,
  TopNav,
  Card,
  AddressAutocomplete,
  type AddressResult,
  XIcon,
  PlusIcon,
  useToast,
} from '@ejm/shared-ui';

// Copy-adapted from apps/web/src/pages/family/FamilySettingsPage.tsx, reduced
// for the Sync/Study family portal:
//   - NO family photo section: study-web has no photo storage/plumbing yet.
//   - Babysitter-specific fields (pets, "notes for babysitters") are omitted;
//     they are left untouched on the shared family doc (this updateDoc only sets
//     the fields it writes).
//
// SHARED ACROSS APPS: `families/{id}` and its `kids` subcollection are the SAME
// documents the Sync/Sit babysitting app reads and writes — a person has ONE
// family record across both products. Edits here are immediately visible in the
// sit app (and vice-versa). Firestore rules already permit family members to
// write these, so no new backend is needed.

interface KidForm {
  clientId: string; // stable React key for the row (persisted or not)
  kidId?: string; // undefined = new kid (not yet persisted)
  firstName: string;
  age: string;
  note?: string;
}

export function FamilySettingsPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId;

  const [familyName, setFamilyName] = useState('');
  const [address, setAddress] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | undefined>();
  // Geocoder components (issue #167): only an autocomplete pick carries them;
  // a manual edit clears them alongside latLng so a stale postcode can never
  // outlive the address it was geocoded from. Search resolves the family's
  // coverage-area label from these.
  const [postcode, setPostcode] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [kids, setKids] = useState<KidForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Track kid docs the user removed (by their persisted kidId) so handleSave can
  // delete exactly those — no re-read of the collection, which avoids a TOCTOU
  // race with concurrent edits from the sit app.
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load family + kids
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    async function load() {
      try {
        const familySnap = await getDoc(doc(db, 'families', familyId!));
        if (!cancelled && familySnap.exists()) {
          const f = familySnap.data() as FamilyDoc;
          setFamilyName(f.familyName || '');
          setAddress(f.address || '');
          setLatLng(f.latLng);
          setPostcode(f.postcode || null);
          setCity(f.city || null);
        }

        const kidsSnap = await getDocs(collection(db, 'families', familyId!, 'kids'));
        if (!cancelled) {
          setKids(
            kidsSnap.docs.map((d) => {
              const k = d.data() as KidDoc;
              return {
                clientId: d.id,
                kidId: d.id,
                firstName: k.firstName,
                age: String(k.age),
                note: k.note || '',
              };
            }),
          );
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('family.settings.saveFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [familyId, t]);

  const addKid = () =>
    setKids([...kids, { clientId: crypto.randomUUID(), firstName: '', age: '' }]);
  const removeKid = (index: number) => {
    const kid = kids[index];
    if (kid.kidId) deletedIdsRef.current.add(kid.kidId);
    setKids(kids.filter((_, i) => i !== index));
  };
  const updateKid = (index: number, field: keyof KidForm, value: string) =>
    setKids(kids.map((k, i) => (i === index ? { ...k, [field]: value } : k)));

  const handleSave = async () => {
    if (!familyId) return;
    setSaving(true);
    setError(null);

    try {
      // Update the shared family doc (only the fields this portal owns).
      await updateDoc(doc(db, 'families', familyId), {
        familyName,
        address,
        latLng: latLng || null,
        postcode: postcode || null,
        city: city || null,
        updatedAt: serverTimestamp(),
      });

      // Delete exactly the kids the user removed this session. Tolerate
      // NOT_FOUND: the sit app may have already deleted the same doc.
      for (const deletedId of deletedIdsRef.current) {
        try {
          await deleteDoc(doc(db, 'families', familyId, 'kids', deletedId));
        } catch (err: unknown) {
          if ((err as { code?: string })?.code !== 'not-found') throw err;
        }
      }
      deletedIdsRef.current.clear();

      for (const kid of kids) {
        if (!kid.firstName.trim()) continue;
        if (kid.kidId) {
          // updateDoc field-merges: DELIBERATELY omit `languages` so the values
          // sit's enrollment writes on this shared doc survive a save here.
          try {
            await updateDoc(doc(db, 'families', familyId, 'kids', kid.kidId), {
              firstName: kid.firstName.trim(),
              age: parseInt(kid.age) || 0,
              note: kid.note?.trim() || null,
            });
          } catch (err: unknown) {
            if ((err as { code?: string })?.code !== 'not-found') throw err;
          }
        } else {
          // New kid — initialize languages to an empty array.
          await addDoc(collection(db, 'families', familyId, 'kids'), {
            firstName: kid.firstName.trim(),
            age: parseInt(kid.age) || 0,
            languages: [],
            note: kid.note?.trim() || null,
          });
        }
      }

      toast(t('family.settings.saved'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('family.settings.saveFailed');
      if (isMountedRef.current) setError(message);
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <TopNav title={t('family.settingsTitle')} backTo="/family" />
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('family.settingsTitle')} backTo="/family" />
      <div className="px-6 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        <p className="mb-5 text-xs text-gray-500">{t('family.settings.sharedHint')}</p>

        <Input
          label={t('family.settings.familyName')}
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          required
        />

        <AddressAutocomplete
          label={t('family.settings.address')}
          value={
            address
              ? { fullAddress: address, street: '', city: '', postcode: '', lat: latLng?.lat || 0, lng: latLng?.lng || 0 }
              : null
          }
          onChange={(addr: AddressResult | null) => {
            setAddress(addr?.fullAddress || '');
            setLatLng(addr ? { lat: addr.lat, lng: addr.lng } : undefined);
            setPostcode(addr?.postcode || null);
            setCity(addr?.city || null);
          }}
        />

        <hr className="my-5 border-gray-200" />

        {/* Kids */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('family.settings.children')}</h3>

        {kids.map((kid, i) => (
          <Card key={kid.clientId} className="mb-3">
            <div className="flex items-start gap-2">
              <div className="flex flex-1 gap-3">
                <div className="flex-1">
                  <Input
                    label={t('family.settings.childName')}
                    value={kid.firstName}
                    onChange={(e) => updateKid(i, 'firstName', e.target.value)}
                    placeholder={t('family.settings.childFirstNamePlaceholder')}
                  />
                </div>
                <div className="w-20">
                  <Input
                    label={t('family.settings.childAge')}
                    type="number"
                    value={kid.age}
                    onChange={(e) => updateKid(i, 'age', e.target.value)}
                    min={0}
                    max={18}
                  />
                </div>
              </div>
              <button
                type="button"
                aria-label={t('family.settings.removeChild')}
                onClick={() => removeKid(i)}
                className="mt-7 rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <Textarea
              label={t('family.settings.kidNote')}
              value={kid.note || ''}
              onChange={(e) => updateKid(i, 'note', e.target.value)}
              placeholder={t('family.settings.kidNotePlaceholder')}
            />
          </Card>
        ))}

        <Button type="button" variant="outline" onClick={addKid} className="mb-6">
          <PlusIcon className="h-4 w-4" />
          {t('family.settings.addChild')}
        </Button>

        <hr className="my-5 border-gray-200" />

        <Button onClick={handleSave} disabled={saving || !familyName.trim()}>
          {saving ? t('common.saving') : t('family.settings.save')}
        </Button>

        {/* Co-parent management (issue #340): study had none at all; it
            lives in family settings here to match sit exactly. */}
        <div className="mt-8 border-t border-gray-100 pt-6">
          <CoParentSection />
        </div>
      </div>
    </div>
  );
}
