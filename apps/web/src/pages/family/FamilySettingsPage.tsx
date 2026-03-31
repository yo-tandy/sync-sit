import { useState, useEffect, useRef } from 'react';
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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Textarea, TopNav, InfoBanner, Card } from '@/components/ui';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { XIcon, PlusIcon } from '@/components/ui/Icons';
import type { ParentUser, FamilyDoc, KidDoc } from '@ejm/shared';

interface KidForm {
  kidId?: string; // undefined = new kid
  firstName: string;
  age: string;
}

export function FamilySettingsPage() {
  const { userDoc } = useAuthStore();
  const parent = userDoc as ParentUser | null;
  const familyId = parent?.familyId;

  const [familyName, setFamilyName] = useState('');
  const [address, setAddress] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | undefined>();
  const [pets, setPets] = useState('');
  const [note, setNote] = useState('');
  const [kids, setKids] = useState<KidForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photo
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  // Load family + kids
  useEffect(() => {
    if (!familyId) return;
    async function load() {
      const familySnap = await getDoc(doc(db, 'families', familyId!));
      if (familySnap.exists()) {
        const f = familySnap.data() as FamilyDoc;
        setFamilyName(f.familyName || '');
        setAddress(f.address || '');
        setLatLng(f.latLng);
        setPets(f.pets || '');
        setNote(f.note || '');
        if (f.photoUrl) setPhotoPreview(f.photoUrl);
      }

      const kidsSnap = await getDocs(collection(db, 'families', familyId!, 'kids'));
      const kidsList = kidsSnap.docs.map((d) => {
        const k = d.data() as KidDoc;
        return { kidId: d.id, firstName: k.firstName, age: String(k.age) };
      });
      setKids(kidsList);
      setLoading(false);
    }
    load();
  }, [familyId]);

  const addKid = () => {
    setKids([...kids, { firstName: '', age: '' }]);
  };

  const removeKid = (index: number) => {
    setKids(kids.filter((_, i) => i !== index));
  };

  const updateKid = (index: number, field: keyof KidForm, value: string) => {
    setKids(kids.map((k, i) => (i === index ? { ...k, [field]: value } : k)));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be under 5 MB');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!familyId) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Upload photo if changed
      let photoUrl: string | null = photoPreview;
      if (photoFile) {
        const ext = photoFile.name.split('.').pop() || 'jpg';
        const path = `family-photos/${familyId}.${ext}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, photoFile);
        photoUrl = await getDownloadURL(storageRef);
      }
      if (!photoPreview) photoUrl = null;

      // Update family doc
      await updateDoc(doc(db, 'families', familyId), {
        familyName,
        address,
        latLng: latLng || null,
        pets: pets || null,
        note: note || null,
        photoUrl,
        updatedAt: serverTimestamp(),
      });

      // Sync kids: delete removed, update existing, add new
      const existingKidsSnap = await getDocs(collection(db, 'families', familyId, 'kids'));
      const existingIds = new Set(existingKidsSnap.docs.map((d) => d.id));
      const currentIds = new Set(kids.filter((k) => k.kidId).map((k) => k.kidId!));

      // Delete removed kids
      for (const existingId of existingIds) {
        if (!currentIds.has(existingId)) {
          await deleteDoc(doc(db, 'families', familyId, 'kids', existingId));
        }
      }

      // Update/create kids
      for (const kid of kids) {
        if (!kid.firstName.trim()) continue;
        const kidData = {
          firstName: kid.firstName.trim(),
          age: parseInt(kid.age) || 0,
          languages: [],
        };
        if (kid.kidId) {
          await updateDoc(doc(db, 'families', familyId, 'kids', kid.kidId), kidData);
        } else {
          await addDoc(collection(db, 'families', familyId, 'kids'), kidData);
        }
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <TopNav title="Edit Family" backTo="/family" />
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title="Edit Family" backTo="/family" />
      <div className="px-6 pt-4 pb-8">
        {success && <InfoBanner className="mb-4">Family info saved!</InfoBanner>}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {/* Family photo */}
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
              <img src={photoPreview} alt="Family" className="h-full w-full object-cover" />
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
                Remove photo
              </button>
            ) : (
              <p className="text-sm font-medium">Add family photo</p>
            )}
            <p className="mt-0.5 text-xs text-gray-400">Optional · Max 5 MB</p>
          </div>
        </div>

        <Input
          label="Family name *"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          required
        />

        <AddressAutocomplete
          label="Address"
          value={address ? { fullAddress: address, street: '', city: '', postcode: '', lat: latLng?.lat || 0, lng: latLng?.lng || 0 } : null}
          onChange={(addr: AddressResult | null) => {
            setAddress(addr?.fullAddress || '');
            setLatLng(addr ? { lat: addr.lat, lng: addr.lng } : undefined);
          }}
        />

        <Input
          label="Pets"
          value={pets}
          onChange={(e) => setPets(e.target.value)}
          placeholder="e.g. Dog, Cat"
        />

        <Textarea
          label="Notes for babysitters"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any info babysitters should know about your family..."
        />

        <hr className="my-5 border-gray-200" />

        {/* Kids */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Children</h3>

        {kids.map((kid, i) => (
          <Card key={kid.kidId || `new-${i}`} className="mb-3">
            <div className="flex items-start gap-2">
              <div className="flex flex-1 gap-3">
                <div className="flex-1">
                  <Input
                    label="Name"
                    value={kid.firstName}
                    onChange={(e) => updateKid(i, 'firstName', e.target.value)}
                    placeholder="First name"
                  />
                </div>
                <div className="w-20">
                  <Input
                    label="Age"
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
                onClick={() => removeKid(i)}
                className="mt-7 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}

        <Button type="button" variant="outline" onClick={addKid} className="mb-6">
          <PlusIcon className="h-4 w-4" />
          Add child
        </Button>

        <Button onClick={handleSave} disabled={saving || !familyName.trim()}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
