import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, getDocs, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Dialog, Button, Input } from '@/components/ui';
import { PhoneInput } from '@/components/forms/PhoneInput';
import type { ParentUser, ReferenceDoc } from '@ejm/shared';

interface ReferenceDialogProps {
  babysitterUserId: string;
  babysitterName: string;
  appointmentId: string;
  existingReference?: ReferenceDoc;
  onClose: () => void;
  onSaved?: () => void;
}

export function ReferenceDialog({
  babysitterUserId,
  babysitterName,
  appointmentId,
  existingReference,
  onClose,
  onSaved,
}: ReferenceDialogProps) {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const parent = userDoc as ParentUser | null;

  // Form fields
  const [text, setText] = useState(existingReference?.referenceText || '');
  const [refName, setRefName] = useState(existingReference?.refName || '');
  const [refPhone, setRefPhone] = useState(existingReference?.refPhone || '');
  const [refWhatsapp, setRefWhatsapp] = useState(existingReference?.refWhatsapp || '');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(
    existingReference ? (existingReference.refWhatsapp === existingReference.refPhone || !existingReference.refWhatsapp) : true
  );
  const [refEmail, setRefEmail] = useState(existingReference?.refEmail || '');
  const [numberOfKids, setNumberOfKids] = useState(existingReference?.numberOfKids || 0);
  const [kidAges, setKidAges] = useState(existingReference?.kidAges?.join(', ') || '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEjmFamily, setIsEjmFamily] = useState(false);

  // Load family data for pre-population
  useEffect(() => {
    if (!parent?.familyId) return;
    async function loadFamily() {
      try {
        const famSnap = await getDoc(doc(db, 'families', parent!.familyId));
        if (famSnap.exists()) {
          const fam = famSnap.data();
          // fam.familyName available if needed
          setIsEjmFamily(!!fam.verification?.isFullyVerified);

          // Pre-populate name as "First LAST" if not editing
          if (!existingReference) {
            const first = parent!.firstName || '';
            const last = ((parent as any).lastName || '').toUpperCase();
            setRefName(`${first} ${last}`.trim());
          }

          // Load kids for count and ages
          const kidsSnap = await getDocs(collection(db, 'families', parent!.familyId, 'kids'));
          if (!existingReference && kidsSnap.size > 0) {
            setNumberOfKids(kidsSnap.size);
            const ages = kidsSnap.docs.map((d) => d.data().age).filter(Boolean).sort((a: number, b: number) => a - b);
            setKidAges(ages.join(', '));
          }
        }

        // Pre-populate contact from parent user if not editing
        if (!existingReference) {
          const parentPhone = (parent as any).phone || '';
          const parentWhatsapp = (parent as any).whatsapp || '';
          setRefPhone(parentPhone || '');
          setRefWhatsapp(parentWhatsapp || parentPhone || '');
          setWhatsappSameAsPhone(parentWhatsapp === parentPhone || !parentWhatsapp);
          setRefEmail(parent!.email || '');
        }
      } catch { /* silent */ }
    }
    loadFamily();
  }, [parent?.familyId]);

  const isEdit = !!existingReference;
  const isValid = text.trim().length >= 10 && refName.trim().length > 0;

  const handleSubmit = async () => {
    if (!parent || !isValid) return;
    setSaving(true);

    const parsedAges = kidAges.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));

    try {
      const whatsappValue = whatsappSameAsPhone ? (refPhone || null) : (refWhatsapp || null);

      if (isEdit && existingReference) {
        await updateDoc(doc(db, 'references', existingReference.referenceId), {
          referenceText: text.trim(),
          refName: refName.trim(),
          refPhone: refPhone || null,
          refWhatsapp: whatsappValue,
          refEmail: refEmail || null,
          numberOfKids: numberOfKids || null,
          kidAges: parsedAges.length > 0 ? parsedAges : null,
          updatedAt: serverTimestamp(),
        });
      } else {
        const ref = await addDoc(collection(db, 'references'), {
          type: 'family_submitted',
          status: 'private',
          babysitterUserId,
          submittedByUserId: parent.uid,
          submittedByFamilyId: parent.familyId,
          submittedByName: refName.trim() || `${parent.firstName || ''} ${((parent as any).lastName || '').toUpperCase()}`.trim(),
          appointmentId: appointmentId || null,
          referenceText: text.trim(),
          refName: refName.trim(),
          refPhone: refPhone || null,
          refWhatsapp: whatsappValue,
          refEmail: refEmail || null,
          isEjmFamily,
          numberOfKids: numberOfKids || null,
          kidAges: parsedAges.length > 0 ? parsedAges : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(ref, { referenceId: ref.id });
      }
      setSaved(true);
      onSaved?.();
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      console.error('Failed to save reference:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose}>
      {saved ? (
        <div className="text-center py-4">
          <div className="mb-3 text-3xl">✅</div>
          <p className="text-sm font-semibold text-gray-900">
            {isEdit ? t('references.referenceUpdated') : t('references.referenceSubmitted')}
          </p>
        </div>
      ) : (
        <>
          <h3 className="mb-1 text-lg font-bold">
            {isEdit
              ? t('references.editMyReference')
              : appointmentId
                ? t('references.referencePrompt', { name: babysitterName })
                : t('references.referencePromptDesc', { name: babysitterName.split(' ')[0] || babysitterName })}
          </h3>
          {!isEdit && appointmentId && (
            <p className="mb-3 text-sm text-gray-500">
              {t('references.referencePromptDesc', { name: babysitterName.split(' ')[0] || babysitterName })}
            </p>
          )}

          {/* Contact fields */}
          <Input
            label={t('references.fullName')}
            value={refName}
            onChange={(e) => setRefName(e.target.value)}
          />
          <Input
            label={t('common.email')}
            type="email"
            value={refEmail}
            onChange={(e) => setRefEmail(e.target.value)}
          />
          <PhoneInput
            label={t('account.phone')}
            value={refPhone}
            onChange={(val) => { setRefPhone(val); if (whatsappSameAsPhone) setRefWhatsapp(val); }}
          />

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
                  if (e.target.checked) setRefWhatsapp(refPhone);
                  else setRefWhatsapp('');
                }}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              {t('account.whatsappSameAsPhone')}
            </label>
            {!whatsappSameAsPhone && (
              <PhoneInput
                label=""
                value={refWhatsapp}
                onChange={setRefWhatsapp}
              />
            )}
          </div>

          {/* Kids */}
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('references.numberOfKids')}
                type="number"
                value={numberOfKids || ''}
                onChange={(e) => setNumberOfKids(e.target.value === '' ? 0 : parseInt(e.target.value))}
                min={0}
              />
            </div>
            <div className="flex-1">
              <Input
                label={t('references.kidAges')}
                value={kidAges}
                onChange={(e) => setKidAges(e.target.value)}
                placeholder="4, 7"
              />
            </div>
          </div>

          {/* Reference text */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('references.referencePlaceholder')}
            rows={4}
            className="mb-3 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 py-3 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
          />
          {text.length > 0 && text.trim().length < 10 && (
            <p className="mb-3 text-xs text-amber-600">{t('references.minLength')}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={saving || !isValid} className="flex-1">
              {saving ? '...' : isEdit ? t('common.save') : t('common.confirm')}
            </Button>
            <Button variant="ghost" onClick={onClose} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
