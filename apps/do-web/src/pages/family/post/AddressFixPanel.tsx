import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  AddressAutocomplete,
  Button,
  Card,
  type AddressResult,
} from '@ejm/shared-ui';
import { db } from '@/config/firebase';

interface AddressFixPanelProps {
  familyId: string;
  onSaved: () => void;
  onBack: () => void;
}

/**
 * The decision-17 UX: `doPostTask` refused with `address_required` — the
 * family's postcode/city resolve no area label, and a task cannot exist
 * without one ("necessary information for the doer"). Rendered IN the
 * wizard (replacing the review step) so the draft survives; the save writes
 * the same family-doc fields the sit/study settings pages own
 * (address + latLng + postcode/city — the geocoder components search
 * resolves the area label from, issue #167), then returns to review for
 * the retry. Only an autocomplete PICK carries postcode/city; there is no
 * manual fallback here because a manual string is exactly what fails to
 * resolve a label.
 */
export function AddressFixPanel({ familyId, onSaved, onBack }: AddressFixPanelProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<AddressResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const handleSave = async () => {
    if (!picked) return;
    setSaving(true);
    setError(false);
    try {
      await updateDoc(doc(db, 'families', familyId), {
        address: picked.fullAddress,
        latLng: { lat: picked.lat, lng: picked.lng },
        postcode: picked.postcode || null,
        city: picked.city || null,
        updatedAt: serverTimestamp(),
      });
      onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50">
      <h2 className="mb-2 text-base font-bold text-gray-950">
        {t('family.post.addressRequiredTitle')}
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-gray-600">
        {t('family.post.addressRequiredBody')}
      </p>

      <AddressAutocomplete
        label={t('family.post.addressLabel')}
        value={picked}
        onChange={(addr: AddressResult | null) => setPicked(addr)}
      />

      {error && <p className="mb-3 text-sm text-error-600">{t('family.post.addressSaveError')}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || !picked} className="flex-1">
          {saving ? t('family.post.addressSaving') : t('family.post.addressSave')}
        </Button>
        <Button variant="ghost" onClick={onBack} className="flex-1">
          {t('family.post.addressBackToReview')}
        </Button>
      </div>
    </Card>
  );
}
