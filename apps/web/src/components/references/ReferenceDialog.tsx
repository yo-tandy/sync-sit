import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Dialog, Button } from '@/components/ui';
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

  const [text, setText] = useState(existingReference?.referenceText || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [familyName, setFamilyName] = useState('');

  // Load family name for attribution
  useEffect(() => {
    if (!parent?.familyId) return;
    getDoc(doc(db, 'families', parent.familyId)).then((snap) => {
      if (snap.exists()) setFamilyName(snap.data().familyName || '');
    }).catch(() => {});
  }, [parent?.familyId]);

  const isEdit = !!existingReference;
  const isValid = text.trim().length >= 10;

  const handleSubmit = async () => {
    if (!parent || !isValid) return;
    setSaving(true);
    try {
      if (isEdit && existingReference) {
        // Update existing reference
        await updateDoc(doc(db, 'references', existingReference.referenceId), {
          referenceText: text.trim(),
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new reference
        const ref = await addDoc(collection(db, 'references'), {
          type: 'family_submitted',
          status: 'private',
          babysitterUserId,
          submittedByUserId: parent.uid,
          submittedByFamilyId: parent.familyId,
          submittedByName: familyName || parent.firstName || '',
          appointmentId: appointmentId || null,
          referenceText: text.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Set referenceId to match the doc ID
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
            <p className="mb-4 text-sm text-gray-500">
              {t('references.referencePromptDesc', { name: babysitterName.split(' ')[0] || babysitterName })}
            </p>
          )}
          {!appointmentId && !isEdit && <div className="mb-3" />}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('references.referencePlaceholder')}
            rows={5}
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
