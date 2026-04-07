import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useReferences } from '@/hooks/useReferences';
import { Button, Card, Badge, Input, Textarea, Dialog, TopNav, Spinner } from '@/components/ui';
import { PlusIcon } from '@/components/ui/Icons';
import type { ReferenceDoc } from '@ejm/shared';

// ── Validation ──
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// French: 0X XX XX XX XX or +33 X XX XX XX XX. International: +XX...
const PHONE_REGEX = /^(\+?\d{1,4}[\s.-]?)?(\(?\d{1,4}\)?[\s.-]?)?\d[\d\s.-]{5,14}$/;

function validatePhone(phone: string): string | null {
  if (!phone) return null; // optional
  if (!PHONE_REGEX.test(phone.trim())) return 'validation.validPhone';
  return null;
}

function validateEmail(email: string): string | null {
  if (!email) return null; // optional
  if (!EMAIL_REGEX.test(email.trim())) return 'validation.validEmail';
  return null;
}

// ── Reference Card ──
function ReferenceCard({
  reference,
  displayName,
  onRemove,
  onEdit,
  onPublish,
  onUnpublish,
}: {
  reference: ReferenceDoc;
  displayName?: string;
  onRemove: () => void;
  onEdit?: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
}) {
  const { t } = useTranslation();
  const isPublished = reference.status === 'published';
  const name = displayName || reference.refName || t('references.unknown');

  return (
    <Card className="mb-3">
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-gray-900">{name}</p>
          <Badge variant={isPublished ? 'green' : 'gray'}>
            {isPublished ? t('references.published') : t('references.private')}
          </Badge>
        </div>
        {reference.refPhone && (
          <p className="text-sm text-gray-500">{reference.refPhone}</p>
        )}
        {reference.refEmail && (
          <p className="text-sm text-gray-500">{reference.refEmail}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {reference.isEjmFamily && <Badge variant="blue">{t('references.ejemFamilyBadge')}</Badge>}
          {reference.numberOfKids != null && reference.numberOfKids > 0 && (
            <span className="text-xs text-gray-500">
              {reference.numberOfKids} {reference.numberOfKids === 1 ? t('references.child') : t('references.children')}
              {reference.kidAges?.length ? ` (${reference.kidAges.join(', ')})` : ''}
            </span>
          )}
        </div>
        {reference.note && (
          <p className="mt-2 text-sm text-gray-600 line-clamp-2">"{reference.note}"</p>
        )}
        {reference.referenceText && (
          <p className="mt-2 text-sm text-gray-600 line-clamp-2">"{reference.referenceText}"</p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {onEdit && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            {t('common.edit')}
          </Button>
        )}
        {!isPublished && onPublish && (
          <Button size="sm" onClick={onPublish}>
            {t('references.publish')}
          </Button>
        )}
        {isPublished && onUnpublish && (
          <Button size="sm" variant="outline" onClick={onUnpublish}>
            {t('references.unpublish')}
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={onRemove}>
          {t('references.delete')}
        </Button>
      </div>
    </Card>
  );
}

// ── Form state ──
interface RefForm {
  refName: string;
  refPhone: string;
  refEmail: string;
  isEjmFamily: boolean;
  numberOfKids: number;
  kidAges: string;
  note: string;
}

const INITIAL_FORM: RefForm = {
  refName: '',
  refPhone: '',
  refEmail: '',
  isEjmFamily: false,
  numberOfKids: 0,
  kidAges: '',
  note: '',
};

function formFromRef(ref: ReferenceDoc): RefForm {
  return {
    refName: ref.refName || '',
    refPhone: ref.refPhone || '',
    refEmail: ref.refEmail || '',
    isEjmFamily: ref.isEjmFamily || false,
    numberOfKids: ref.numberOfKids || 0,
    kidAges: ref.kidAges?.join(', ') || '',
    note: ref.note || '',
  };
}

function formToData(form: RefForm) {
  return {
    refName: form.refName.trim(),
    refPhone: form.refPhone.trim() || undefined,
    refEmail: form.refEmail.trim() || undefined,
    isEjmFamily: form.isEjmFamily,
    numberOfKids: form.numberOfKids || undefined,
    kidAges: form.kidAges
      ? form.kidAges.split(',').map((a) => parseInt(a.trim())).filter((n) => !isNaN(n))
      : undefined,
    note: form.note.trim() || undefined,
  };
}

// ── Reference Form Dialog ──
function RefFormDialog({
  open,
  onClose,
  title,
  form,
  setForm,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  form: RefForm;
  setForm: (f: RefForm) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const phoneError = validatePhone(form.refPhone);
  const emailError = validateEmail(form.refEmail);
  const hasErrors = !!phoneError || !!emailError;

  return (
    <Dialog open={open} onClose={onClose}>
      <h3 className="mb-4 text-lg font-bold">{title}</h3>

      <Input
        label={t('references.fullName')}
        value={form.refName}
        onChange={(e) => setForm({ ...form, refName: e.target.value })}
        required
      />

      <Input
        label={t('common.phone')}
        type="tel"
        value={form.refPhone}
        onChange={(e) => setForm({ ...form, refPhone: e.target.value })}
        placeholder="+33 6 12 34 56 78"
        error={form.refPhone ? (phoneError ? t(phoneError) : undefined) : undefined}
      />

      <Input
        label={t('common.email')}
        type="email"
        value={form.refEmail}
        onChange={(e) => setForm({ ...form, refEmail: e.target.value })}
        placeholder="name@example.com"
        error={form.refEmail ? (emailError ? t(emailError) : undefined) : undefined}
      />

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('references.ejemFamily')}</label>
        <button
          type="button"
          onClick={() => setForm({ ...form, isEjmFamily: !form.isEjmFamily })}
          className={`rounded-lg border-[1.5px] px-4 py-2 text-sm font-medium transition-colors ${
            form.isEjmFamily
              ? 'border-red-600 bg-red-50 text-red-600'
              : 'border-gray-300 text-gray-700'
          }`}
        >
          {form.isEjmFamily ? `✓ ${t('common.yes')}` : t('common.no')}
        </button>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label={t('references.numberOfKids')}
            type="number"
            value={form.numberOfKids || ''}
            onChange={(e) => setForm({ ...form, numberOfKids: parseInt(e.target.value) || 0 })}
            min={0}
            max={10}
          />
        </div>
        <div className="flex-1">
          <Input
            label={t('references.kidAges')}
            value={form.kidAges}
            onChange={(e) => setForm({ ...form, kidAges: e.target.value })}
            placeholder="4, 7, 10"
          />
        </div>
      </div>

      <Textarea
        label={t('references.note')}
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder={t('references.notePlaceholder')}
      />

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onSave}
          disabled={!form.refName.trim() || hasErrors || saving}
          className="flex-1"
        >
          {saving ? t('common.saving') : t('references.saveReference')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Main Page ──
export function ReferencesPage() {
  const { t } = useTranslation();
  const {
    manualRefs,
    familySubmittedRefs,
    loading,
    addManualReference,
    updateManualReference,
    removeReference,
    publishReference,
    unpublishReference,
  } = useReferences();

  // Load family names for family-submitted refs that don't have submittedByName
  const [familyNames, setFamilyNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const missing = familySubmittedRefs.filter(
      (r) => !(r as any).submittedByName && r.submittedByFamilyId && !familyNames[r.submittedByFamilyId]
    );
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (r) => {
        try {
          const snap = await getDoc(doc(db, 'families', r.submittedByFamilyId!));
          if (snap.exists()) return [r.submittedByFamilyId!, snap.data().familyName || ''] as [string, string];
        } catch { /* skip */ }
        return null;
      })
    ).then((results) => {
      const names: Record<string, string> = {};
      for (const r of results) { if (r) names[r[0]] = r[1]; }
      if (Object.keys(names).length > 0) setFamilyNames((prev) => ({ ...prev, ...names }));
    });
  }, [familySubmittedRefs]);

  const getFamilyRefName = (ref: ReferenceDoc) =>
    (ref as any).submittedByName || (ref.submittedByFamilyId ? familyNames[ref.submittedByFamilyId] : null) || undefined;

  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editingRefId, setEditingRefId] = useState<string | null>(null);
  const [form, setForm] = useState<RefForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setForm(INITIAL_FORM);
    setEditingRefId(null);
    setDialogMode('add');
  };

  const openEdit = (ref: ReferenceDoc) => {
    setForm(formFromRef(ref));
    setEditingRefId(ref.referenceId);
    setDialogMode('edit');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = formToData(form);
      if (dialogMode === 'edit' && editingRefId) {
        await updateManualReference(editingRefId, data);
      } else {
        await addManualReference(data);
      }
      setForm(INITIAL_FORM);
      setDialogMode(null);
      setEditingRefId(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <TopNav title={t('references.title')} backTo="/babysitter" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('references.title')} backTo="/babysitter" />

      <div className="px-5 pt-4 pb-8">
        {/* Manual references */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{t('references.myReferences')}</h3>
          <button
            onClick={openAdd}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {manualRefs.length === 0 ? (
          <p className="mb-4 text-sm text-gray-400">{t('references.noReferencesYet')}</p>
        ) : (
          manualRefs.map((ref) => (
            <ReferenceCard
              key={ref.referenceId}
              reference={ref}
              onEdit={() => openEdit(ref)}
              onRemove={() => removeReference(ref.referenceId)}
              onPublish={() => publishReference(ref.referenceId)}
              onUnpublish={() => unpublishReference(ref.referenceId)}
            />
          ))
        )}

        {/* Family submitted */}
        {familySubmittedRefs.length > 0 && (
          <>
            <hr className="my-4 border-gray-200" />
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('references.familyReviews')}</h3>
            {familySubmittedRefs.map((ref) => (
              <ReferenceCard
                key={ref.referenceId}
                reference={ref}
                displayName={getFamilyRefName(ref)}
                onRemove={() => removeReference(ref.referenceId)}
                onPublish={() => publishReference(ref.referenceId)}
                onUnpublish={() => unpublishReference(ref.referenceId)}
              />
            ))}
          </>
        )}
      </div>

      {/* Add / Edit dialog */}
      {dialogMode && (
        <RefFormDialog
          open
          onClose={() => { setDialogMode(null); setEditingRefId(null); }}
          title={dialogMode === 'edit' ? t('references.editReference') : t('references.addReference')}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}
