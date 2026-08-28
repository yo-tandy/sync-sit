import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@ejm/shared-ui';
import {
  DO_DOER_BIO_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  TASK_CATEGORIES,
  type TaskCategory,
} from '@ejm/do-core';

export interface DoerDetailsData {
  categories: TaskCategory[];
  bio?: string;
  hasCar: boolean;
  hasBike: boolean;
  notifyNewTasks: boolean;
  defaultRate?: number | null;
}

interface StepDoerDetailsProps {
  onNext: (data: DoerDetailsData) => void;
  loading: boolean;
  error: string | null;
  /** Draft preserved across a back-navigation. */
  initial?: DoerDetailsData | null;
  onBack?: (draft: DoerDetailsData) => void;
}

/**
 * The doer-specific step (§3.3): digest categories (ALL preselected — the
 * modal intent stated as data; an empty selection means "no digests", never
 * "all"), transport, bio, optional default rate, and the new-task digest
 * toggle. This is the submitting step — doEnrollDoer runs on submit.
 */
export function StepDoerDetails({ onNext, loading, error, initial = null, onBack }: StepDoerDetailsProps) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<TaskCategory[]>(
    initial?.categories ?? [...TASK_CATEGORIES],
  );
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [hasCar, setHasCar] = useState(initial?.hasCar ?? false);
  const [hasBike, setHasBike] = useState(initial?.hasBike ?? false);
  const [notifyNewTasks, setNotifyNewTasks] = useState(initial?.notifyNewTasks ?? true);
  const [defaultRate, setDefaultRate] = useState(
    initial?.defaultRate != null ? String(initial.defaultRate) : '',
  );

  const toggleCategory = (c: TaskCategory) => {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const parsedRate = defaultRate.trim() === '' ? null : Number(defaultRate);
  const rateValid =
    parsedRate === null ||
    (Number.isFinite(parsedRate) && parsedRate >= DO_PRICE_MIN && parsedRate <= DO_PRICE_MAX);
  const bioValid = bio.length <= DO_DOER_BIO_MAX;
  const isValid = rateValid && bioValid && !loading;

  const collect = (): DoerDetailsData => ({
    // Keep the board's display order regardless of click order.
    categories: TASK_CATEGORIES.filter((c) => categories.includes(c)),
    bio: bio.trim() || undefined,
    hasCar,
    hasBike,
    notifyNewTasks,
    defaultRate: parsedRate,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext(collect());
  };

  return (
    <form onSubmit={handleSubmit} className="px-6 pb-8">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('enrollment.doer.detailsTitle')}</h2>
      <p className="mb-5 text-sm text-gray-500">{t('enrollment.doer.detailsSubtitle')}</p>

      {/* Digest categories */}
      <p className="mb-1 text-sm font-semibold text-gray-700">{t('enrollment.doer.categoriesLabel')}</p>
      <p className="mb-3 text-xs text-gray-500">{t('enrollment.doer.categoriesHint')}</p>
      <div className="mb-5 flex flex-wrap gap-2">
        {TASK_CATEGORIES.map((c) => {
          const selected = categories.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleCategory(c)}
              className={`rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? 'border-brand-600 bg-brand-50 text-brand-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {t(`categories.${c}`)}
            </button>
          );
        })}
      </div>
      {categories.length === 0 && (
        <p className="-mt-3 mb-5 text-xs text-gray-500">{t('enrollment.doer.categoriesNoneHint')}</p>
      )}

      {/* Transport */}
      <p className="mb-2 text-sm font-semibold text-gray-700">{t('enrollment.doer.transportLabel')}</p>
      <div className="mb-5 flex gap-2">
        {([
          ['hasBike', hasBike, setHasBike, 'enrollment.doer.hasBike'],
          ['hasCar', hasCar, setHasCar, 'enrollment.doer.hasCar'],
        ] as const).map(([key, value, setValue, labelKey]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value}
            onClick={() => setValue(!value)}
            className={`flex-1 rounded-lg border-[1.5px] px-2 py-2 text-sm font-medium transition-colors ${
              value
                ? 'border-brand-600 bg-brand-50 text-brand-600'
                : 'border-gray-300 text-gray-700 hover:border-gray-400'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Bio */}
      <label className="mb-1 block text-sm font-semibold text-gray-700" htmlFor="doer-bio">
        {t('enrollment.doer.bioLabel')}
      </label>
      <textarea
        id="doer-bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder={t('enrollment.doer.bioPlaceholder')}
        maxLength={DO_DOER_BIO_MAX}
        rows={4}
        className="mb-5 w-full rounded-lg border-[1.5px] border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
      />

      {/* Default rate */}
      <Input
        label={t('enrollment.doer.defaultRateLabel')}
        type="number"
        inputMode="decimal"
        min={DO_PRICE_MIN}
        max={DO_PRICE_MAX}
        value={defaultRate}
        onChange={(e) => setDefaultRate(e.target.value)}
        error={rateValid ? undefined : t('enrollment.doer.defaultRateError', { min: DO_PRICE_MIN, max: DO_PRICE_MAX })}
      />
      <p className="-mt-3 mb-5 text-xs text-gray-500">{t('enrollment.doer.defaultRateHint')}</p>

      {/* New-task digest opt-in */}
      <label className="mb-6 flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={notifyNewTasks}
          onChange={(e) => setNotifyNewTasks(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        />
        <span>{t('enrollment.doer.notifyNewTasks')}</span>
      </label>

      {error && <p className="mb-4 text-sm text-error-600">{error}</p>}

      <Button type="submit" disabled={!isValid}>
        {loading ? t('auth.creatingAccount') : t('enrollment.completeSignup')}
      </Button>
      {onBack && (
        <button
          type="button"
          onClick={() => onBack(collect())}
          className="mt-3 w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          {t('common.back')}
        </button>
      )}
    </form>
  );
}
