import { useTranslation } from 'react-i18next';
import { DO_TASK_DESCRIPTION_MAX, DO_TASK_TITLE_MAX } from '@ejm/do-core';
import { Card, Input, Textarea } from '@ejm/shared-ui';
import { useConsiderations } from '@/lib/considerations';
import type { StepProps } from './steps';

/**
 * Title + free-text description WITH the §5 considerations list rendered
 * ALONGSIDE (surface 1 of 3): hints beside the box, never pre-filling or
 * constraining the text — the description stays free (decision 5).
 */
export function StepDescribe({ draft, update }: StepProps) {
  const { t } = useTranslation();
  const considerations = useConsiderations(draft.subCategory);

  return (
    <div>
      <Input
        label={t('family.post.titleLabel')}
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder={t('family.post.titlePlaceholder')}
        maxLength={DO_TASK_TITLE_MAX + 1}
        error={
          draft.title.length > DO_TASK_TITLE_MAX
            ? t('family.post.titleTooLong', { max: DO_TASK_TITLE_MAX })
            : undefined
        }
      />
      <Textarea
        label={t('family.post.descriptionLabel')}
        value={draft.description}
        onChange={(e) => update({ description: e.target.value })}
        placeholder={t('family.post.descriptionPlaceholder')}
        rows={7}
        error={
          draft.description.length > DO_TASK_DESCRIPTION_MAX
            ? t('family.post.descriptionTooLong', { max: DO_TASK_DESCRIPTION_MAX })
            : undefined
        }
      />

      {considerations.length > 0 && (
        <Card className="border-brand-100 bg-brand-50">
          <h3 className="mb-1 text-sm font-semibold text-brand-800">
            {t('family.post.considerationsTitle')}
          </h3>
          <p className="mb-2 text-xs text-gray-500">{t('family.post.considerationsHint')}</p>
          <ul className="list-disc space-y-1 pl-4">
            {considerations.map((line) => (
              <li key={line} className="text-xs leading-relaxed text-gray-600">
                {line}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
