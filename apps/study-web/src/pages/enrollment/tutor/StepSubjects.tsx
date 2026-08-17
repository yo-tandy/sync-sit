import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUBJECTS, CLASS_LEVELS, type SubjectOffering } from '@ejm/study-core';
import { Button, Select, Input, Chip, Card } from '@ejm/shared-ui';

interface StepSubjectsProps {
  onNext: (subjects: SubjectOffering[]) => void;
  loading?: boolean;
  error?: string | null;
}

// Local row shape mirrors SubjectsPage: rate is editable, so it may be blank
// mid-edit.
interface Row {
  subject: string;
  levels: string[];
  rate: number | '';
}

/**
 * First post-auth signup step (issue #143): subjects, levels and rate — the
 * information families search by. Same row idiom and validation as the portal
 * SubjectsPage (subject set, no duplicates, at least one level, rate > 0),
 * plus at least one row: enrolling with zero subjects would produce a tutor
 * invisible to search.
 */
export function StepSubjects({ onNext, loading = false, error: submitError = null }: StepSubjectsProps) {
  const { t } = useTranslation();
  // Start with one empty row — the step exists to collect at least one.
  const [rows, setRows] = useState<Row[]>([{ subject: '', levels: [], rate: '' }]);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    setRows((prev) => [...prev, { subject: '', levels: [], rate: '' }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const setSubject = (index: number, subject: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, subject } : r)));
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
  };

  const setRate = (index: number, value: string) => {
    const rate = value === '' ? '' : parseFloat(value);
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, rate: Number.isNaN(rate as number) ? '' : rate } : r)),
    );
  };

  const validate = (): string | null => {
    if (rows.length === 0) return t('enrollment.subjectsEmpty');
    if (rows.some((r) => !r.subject)) return t('tutor.subjects.errorNoSubject');
    const subjects = rows.map((r) => r.subject);
    if (new Set(subjects).size !== subjects.length) return t('tutor.subjects.errorDuplicate');
    if (rows.some((r) => r.levels.length === 0)) return t('tutor.subjects.errorNoLevels');
    if (rows.some((r) => r.rate === '' || Number(r.rate) <= 0)) return t('tutor.subjects.errorRate');
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    onNext(
      rows.map((r) => ({
        subject: r.subject,
        levels: r.levels,
        rate: Number(r.rate),
      })) as SubjectOffering[],
    );
  };

  const subjectOptions = SUBJECTS.map((s) => ({
    value: s,
    label: t(`tutor.subjects.names.${s}`),
  }));

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('enrollment.subjectsTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.subjectsSubtitle')}</p>

      {rows.length === 0 && (
        <p className="mb-5 text-sm text-gray-500">{t('enrollment.subjectsEmpty')}</p>
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
              id={`subject-${index}`}
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
              id={`subject-rate-${index}`}
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

      {submitError && <p className="mt-4 text-sm text-brand-600">{submitError}</p>}

      <Button type="submit" disabled={rows.length === 0 || loading} className="mt-4">
        {loading ? t('common.loading') : t('enrollment.completeSignup')}
      </Button>
    </form>
  );
}
