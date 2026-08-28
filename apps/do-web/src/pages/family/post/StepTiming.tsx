import { useTranslation } from 'react-i18next';
import type { TaskCadence, TaskTiming } from '@ejm/do-core';
import { Chip, Input } from '@ejm/shared-ui';
import type { StepProps } from './steps';

const DAY_KEYS: NonNullable<TaskCadence['days']> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * The §9.1 timing step: the four §4.1 models, each with its own small form.
 * Field-level validity is do-core's (isStepValid runs validateTaskTiming +
 * validateTaskTimingNotPast with the client clock, pre-empting the round
 * trip); this component only collects.
 */
export function StepTiming({ draft, update }: StepProps) {
  const { t } = useTranslation();
  const models: TaskTiming[] = ['fixed', 'deadline', 'recurring', 'ongoing'];

  const cadenceForm = (
    <>
      <p className="mb-2 text-sm font-medium text-gray-700">{t('timing.cadenceLabel')}</p>
      <div className="mb-4 flex gap-2">
        {(['daily', 'weekly', 'custom'] as const).map((kind) => (
          <Chip
            key={kind}
            selected={draft.cadenceKind === kind}
            onClick={() => update({ cadenceKind: kind })}
          >
            {t(`timing.cadence${kind.charAt(0).toUpperCase()}${kind.slice(1)}`)}
          </Chip>
        ))}
      </div>
      {draft.cadenceKind === 'weekly' && (
        <>
          <p className="mb-2 text-sm font-medium text-gray-700">{t('timing.cadenceDaysLabel')}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {DAY_KEYS.map((day) => (
              <Chip
                key={day}
                selected={draft.cadenceDays.includes(day)}
                onClick={() =>
                  update({
                    cadenceDays: draft.cadenceDays.includes(day)
                      ? draft.cadenceDays.filter((d) => d !== day)
                      : [...draft.cadenceDays, day],
                  })
                }
              >
                {t(`timing.day.${day}`)}
              </Chip>
            ))}
          </div>
        </>
      )}
      {draft.cadenceKind === 'custom' && (
        <Input
          label={t('timing.cadenceNoteLabel')}
          value={draft.cadenceNote}
          onChange={(e) => update({ cadenceNote: e.target.value })}
          placeholder={t('timing.cadenceNotePlaceholder')}
        />
      )}
      <Input
        label={t('timing.cadenceTimeHintLabel')}
        value={draft.cadenceTimeHint}
        onChange={(e) => update({ cadenceTimeHint: e.target.value })}
        placeholder={t('timing.cadenceTimeHintPlaceholder')}
      />
    </>
  );

  return (
    <div>
      {models.map((model) => (
        <button
          key={model}
          type="button"
          aria-pressed={draft.timing === model}
          onClick={() => update({ timing: model })}
          className={`mb-2 w-full rounded-xl border-[1.5px] p-4 text-left transition-colors ${
            draft.timing === model
              ? 'border-brand-600 bg-brand-50'
              : 'border-gray-200 bg-white hover:border-brand-300'
          }`}
        >
          <span className="block text-sm font-semibold text-gray-900">{t(`timing.${model}`)}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{t(`timing.${model}Desc`)}</span>
        </button>
      ))}

      {draft.timing && <div className="mt-5 border-t border-gray-100 pt-5" />}

      {draft.timing === 'fixed' && (
        <>
          <Input
            label={t('timing.dateLabel')}
            type="date"
            value={draft.date}
            onChange={(e) => update({ date: e.target.value })}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('timing.startTimeLabel')}
                type="time"
                value={draft.startTime}
                onChange={(e) => update({ startTime: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <Input
                label={t('timing.endTimeLabel')}
                type="time"
                value={draft.endTime}
                onChange={(e) => update({ endTime: e.target.value })}
              />
            </div>
          </div>
          {/* Midnight-crossing is legal (§4.1: a 20:00–01:00 clean-up ends
              the next day) — say so instead of "fixing" it. */}
          {draft.startTime && draft.endTime && draft.endTime <= draft.startTime && (
            <p className="-mt-3 mb-3 text-xs text-gray-500">{t('timing.overnightHint')}</p>
          )}
        </>
      )}

      {draft.timing === 'deadline' && (
        <Input
          label={t('timing.dueDateLabel')}
          type="date"
          value={draft.dueDate}
          onChange={(e) => update({ dueDate: e.target.value })}
        />
      )}

      {(draft.timing === 'recurring' || draft.timing === 'ongoing') && (
        <>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label={t('timing.startDateLabel')}
                type="date"
                value={draft.startDate}
                onChange={(e) => update({ startDate: e.target.value })}
              />
            </div>
            {draft.timing === 'recurring' && (
              <div className="flex-1">
                <Input
                  label={t('timing.endDateLabel')}
                  type="date"
                  value={draft.endDate}
                  onChange={(e) => update({ endDate: e.target.value })}
                />
              </div>
            )}
          </div>
          {cadenceForm}
        </>
      )}

      {draft.timing && (
        <Input
          label={t('timing.estimatedHoursLabel')}
          type="number"
          inputMode="decimal"
          min={0}
          value={draft.estimatedHours}
          onChange={(e) => update({ estimatedHours: e.target.value })}
          hint={t('timing.estimatedHoursHint')}
        />
      )}
    </div>
  );
}
