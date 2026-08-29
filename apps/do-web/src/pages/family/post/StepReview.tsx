import { useTranslation } from 'react-i18next';
import { getSubCategoryDef } from '@ejm/do-core';
import { Button, Card, InfoBanner } from '@ejm/shared-ui';
import { formatTimingSummary, type TimingLike } from '@/lib/taskDisplay';
import type { TaskDraft } from './postTaskDraft';
import { parsedBudget } from './postTaskDraft';

export type PublishErrorKey = 'generic' | 'cap' | 'denied' | null;

interface StepReviewProps {
  draft: TaskDraft;
  publishing: boolean;
  publishError: PublishErrorKey;
  onPublish: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right text-xs font-medium text-gray-900">{value}</span>
    </div>
  );
}

/**
 * Review + publish (§9.1). Carries, in order:
 * - the §11.2 publish-visibility warning, mirroring the publishedSearches
 *   publish dialog ("visible to every enrolled student" — no server-side
 *   redaction, the warning is the mitigation);
 * - the decision-15 liability line (§11.5: "the posting flow says it once,
 *   plainly, at the review step");
 * - the §5.6 handles-family-money standing line when the sub-category is
 *   flagged.
 */
export function StepReview({ draft, publishing, publishError, onPublish }: StepReviewProps) {
  const { t } = useTranslation();
  const def = draft.subCategory ? getSubCategoryDef(draft.subCategory) : undefined;
  const budget = parsedBudget(draft);

  const yesNo = (v: boolean) => (v ? t('family.post.reviewYes') : t('family.post.reviewNo'));

  return (
    <div>
      <h2 className="mb-3 text-base font-bold text-gray-950">{t('family.post.reviewTitle')}</h2>

      <Card className="mb-4">
        <p className="mb-1 text-sm font-semibold text-gray-900">{draft.title}</p>
        <p className="mb-3 text-xs whitespace-pre-wrap text-gray-600">{draft.description}</p>
        <div className="border-t border-gray-100 pt-2">
          <Row
            label={t('family.post.reviewCategory')}
            value={`${t(`categories.${draft.category}`)} · ${t(`subcategories.${draft.subCategory}`)}`}
          />
          <Row
            label={t('family.post.reviewTiming')}
            value={formatTimingSummary(t, {
              timing: draft.timing,
              date: draft.date,
              startTime: draft.startTime,
              endTime: draft.endTime,
              dueDate: draft.dueDate,
              startDate: draft.startDate,
              endDate: draft.endDate,
            } as TimingLike)}
          />
          <Row
            label={t('family.post.stepPhotos')}
            value={t('family.post.reviewPhotos', { count: draft.photos.length })}
          />
          <Row
            label={t('family.post.reviewAdultPresent')}
            value={
              draft.adultPresent === 'partly'
                ? t('family.post.reviewPartly')
                : yesNo(draft.adultPresent === 'yes')
            }
          />
          {draft.toolsProvided !== null && (
            <Row label={t('family.post.reviewTools')} value={yesNo(draft.toolsProvided)} />
          )}
          <Row label={t('family.post.reviewTransport')} value={yesNo(draft.transportNeeded)} />
          {budget !== null && (
            <Row label={t('family.post.reviewBudget')} value={`${budget} €`} />
          )}
        </div>
      </Card>

      {def?.flags.handlesFamilyMoney && (
        <InfoBanner className="mb-3">{t('family.post.moneyNotice')}</InfoBanner>
      )}

      <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
        {t('family.post.publishWarning')}
      </p>
      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        {t('family.post.liabilityNotice')}
      </p>

      {publishError && (
        <p className="mb-3 text-sm text-error-600">
          {publishError === 'cap'
            ? t('family.post.capError')
            : publishError === 'denied'
              ? t('family.post.postDeniedError')
              : t('family.post.publishError')}
        </p>
      )}

      <Button onClick={onPublish} disabled={publishing}>
        {publishing ? t('family.post.publishing') : t('family.post.publishCta')}
      </Button>
    </div>
  );
}
