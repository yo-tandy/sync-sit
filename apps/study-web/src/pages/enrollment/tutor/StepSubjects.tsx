import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SubjectOffering {
  subject: string;
  levels: string[];
  rate: number;
}

interface StepSubjectsProps {
  onNext: (subjects: SubjectOffering[]) => void;
}

const SUBJECTS = [
  'math',
  'french',
  'english',
  'spanish',
  'german',
  'physics',
  'chemistry',
  'svt',
  'history_geo',
  'philosophy',
  'ses',
  'nsi',
  'art',
  'music',
] as const;

const CLASS_LEVELS = [
  'CP', 'CE1', 'CE2', 'CM1', 'CM2',
  '6e', '5e', '4e', '3e',
  '2nde', '1ere', 'Terminale',
  'IB_MYP4', 'IB_MYP5', 'IB_DP1', 'IB_DP2',
] as const;

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Mathematics',
  french: 'French',
  english: 'English',
  spanish: 'Spanish',
  german: 'German',
  physics: 'Physics',
  chemistry: 'Chemistry',
  svt: 'SVT (Life Sciences)',
  history_geo: 'History-Geography',
  philosophy: 'Philosophy',
  ses: 'SES (Economics)',
  nsi: 'NSI (Computer Science)',
  art: 'Art',
  music: 'Music',
};

export function StepSubjects({ onNext }: StepSubjectsProps) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [rate, setRate] = useState<number | ''>('');

  const toggleLevel = (level: string) => {
    setSelectedLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  };

  const isValid = subject && selectedLevels.length > 0 && rate !== '' && Number(rate) >= 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext([{ subject, levels: selectedLevels, rate: Number(rate) }]);
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.subjectsTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.subjectsSubtitle')}</p>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.subject')}</label>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
          required
        >
          <option value="">{t('enrollment.selectSubject')}</option>
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>{SUBJECT_LABELS[s] ?? s}</option>
          ))}
        </select>
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.levels')}</label>
        <div className="flex flex-wrap gap-2">
          {CLASS_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggleLevel(level)}
              className={`rounded-lg border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedLevels.includes(level)
                  ? 'border-red-600 bg-red-50 text-red-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        {selectedLevels.length === 0 && (
          <p className="mt-1.5 text-xs text-gray-400">Select at least one level</p>
        )}
      </div>

      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.rateLabel')}</label>
        <input
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value === '' ? '' : parseFloat(e.target.value))}
          min={0}
          placeholder="e.g. 20"
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
          required
        />
      </div>

      <button
        type="submit"
        disabled={!isValid}
        className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
      >
        {t('common.continue')}
      </button>
    </form>
  );
}
