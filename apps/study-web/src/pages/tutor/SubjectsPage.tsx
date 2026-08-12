import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  SUBJECTS,
  CLASS_LEVELS,
  getTutorProfile,
  type SubjectOffering,
} from '@ejm/study-core';
import { Button, Select, Input, Chip, Card, TopNav } from '@ejm/shared-ui';

/**
 * Subjects & rates editor. Each row is one SubjectOffering
 * ({subject, levels, rate}); tutors add/remove rows, pick a subject, toggle the
 * class levels they cover, and set an hourly rate.
 *
 * Client validation blocks save on: a row without a subject, duplicate
 * subjects, a row with no levels, or a rate that is not > 0 — mirroring the
 * backend's owner-write contract. Save writes only `profiles.tutor.subjects`
 * (an owner-permitted field) plus `updatedAt`, then refreshes the user doc.
 */

// Local row shape: rate is editable, so it may be blank mid-edit.
interface Row {
  subject: string;
  levels: string[];
  rate: number | '';
}

function toRow(o: SubjectOffering): Row {
  return { subject: o.subject, levels: o.levels, rate: o.rate };
}

export function SubjectsPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise from the stored offerings (mirrors BabysittingOptionsPage).
  useEffect(() => {
    if (!tutor) return;
    setRows((tutor.subjects ?? []).map(toRow));
  }, [tutor]);

  const addRow = () => {
    setRows((prev) => [...prev, { subject: '', levels: [], rate: '' }]);
    setSuccess(false);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setSuccess(false);
  };

  const setSubject = (index: number, subject: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, subject } : r)));
    setSuccess(false);
  };

  const toggleLevel = (index: number, level: string) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              levels: r.levels.includes(level)
                ? r.levels.filter((l) => l !== level)
                : [...r.levels, level],
            }
          : r,
      ),
    );
    setSuccess(false);
  };

  const setRate = (index: number, value: string) => {
    const rate = value === '' ? '' : parseFloat(value);
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, rate: Number.isNaN(rate as number) ? '' : rate } : r)),
    );
    setSuccess(false);
  };

  const validate = (): string | null => {
    if (rows.some((r) => !r.subject)) return t('tutor.subjects.errorNoSubject');
    const subjects = rows.map((r) => r.subject);
    if (new Set(subjects).size !== subjects.length) return t('tutor.subjects.errorDuplicate');
    if (rows.some((r) => r.levels.length === 0)) return t('tutor.subjects.errorNoLevels');
    if (rows.some((r) => r.rate === '' || Number(r.rate) <= 0)) return t('tutor.subjects.errorRate');
    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setSuccess(false);
      return;
    }

    const offerings: SubjectOffering[] = rows.map((r) => ({
      subject: r.subject,
      levels: r.levels,
      rate: Number(r.rate),
    }));

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.subjects': offerings,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError(t('tutor.subjects.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const subjectOptions = SUBJECTS.map((s) => ({
    value: s,
    label: t(`tutor.subjects.names.${s}`),
  }));

  return (
    <div>
      <TopNav title={t('tutor.subjectsTitle')} backTo="/tutor" />

      <form onSubmit={handleSave} className="px-5 pt-4 pb-8">
        <p className="mb-5 text-sm text-gray-500">{t('tutor.subjects.intro')}</p>

        {rows.length === 0 && (
          <p className="mb-5 text-sm text-gray-500">{t('tutor.subjects.empty')}</p>
        )}

        <div className="space-y-3">
          {rows.map((row, index) => (
            <Card key={index} data-testid="subject-row" className="relative">
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label={t('tutor.subjects.remove')}
                className="absolute right-3 top-3 text-xs font-medium text-gray-500 hover:text-brand-600"
              >
                {t('tutor.subjects.remove')}
              </button>

              <Select
                label={t('tutor.subjects.subjectLabel')}
                value={row.subject}
                onChange={(e) => setSubject(index, e.target.value)}
                placeholder={t('tutor.subjects.selectSubject')}
                options={subjectOptions}
              />

              <div className="mb-5 -mt-2">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t('tutor.subjects.levelsLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {CLASS_LEVELS.map((level) => (
                    <Chip
                      key={level}
                      selected={row.levels.includes(level)}
                      onClick={() => toggleLevel(index, level)}
                    >
                      {level}
                    </Chip>
                  ))}
                </div>
              </div>

              <Input
                label={t('tutor.subjects.rateLabel')}
                type="number"
                value={row.rate}
                onChange={(e) => setRate(index, e.target.value)}
                min={0}
                step="0.5"
                placeholder={t('tutor.subjects.ratePlaceholder')}
              />
            </Card>
          ))}
        </div>

        <Button type="button" variant="outline" onClick={addRow} className="mt-3">
          {t('tutor.subjects.addRow')}
        </Button>

        {error && <p className="mt-4 text-sm text-brand-600">{error}</p>}
        {success && <p className="mt-4 text-sm text-green-600">✓ {t('tutor.subjects.saved')}</p>}

        <Button type="submit" disabled={saving} className="mt-4">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </form>
    </div>
  );
}
