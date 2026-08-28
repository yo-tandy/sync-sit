import { useTranslation } from 'react-i18next';
import {
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  TASK_CATEGORIES,
  getSubCategories,
  getSubCategoryDef,
  validateSuggestedBudget,
  type AdultPresence,
} from '@ejm/do-core';
import { Checkbox, InfoBanner, Input } from '@ejm/shared-ui';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { ALONE_HOME_SUBCATEGORIES, parsedBudget, type TaskDraft } from './postTaskDraft';

/**
 * The wizard's option-pick steps (plan §9.1 bullet 1). Each renders inputs
 * only — the Next/Back footer and the step gating live in PostTaskPage, so
 * gating has exactly one implementation (postTaskDraft.isStepValid).
 */

export interface StepProps {
  draft: TaskDraft;
  update: (changes: Partial<TaskDraft>) => void;
}

function OptionButton({
  selected,
  onClick,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`mb-2 w-full rounded-xl border-[1.5px] p-4 text-left transition-colors ${
        selected
          ? 'border-brand-600 bg-brand-50'
          : 'border-gray-200 bg-white hover:border-brand-300'
      }`}
    >
      <span className="block text-sm font-semibold text-gray-900">{title}</span>
      {desc && <span className="mt-0.5 block text-xs text-gray-500">{desc}</span>}
    </button>
  );
}

export function StepCategory({ draft, update }: StepProps) {
  const { t } = useTranslation();
  return (
    <div>
      {TASK_CATEGORIES.map((cat) => (
        <OptionButton
          key={cat}
          selected={draft.category === cat}
          title={t(`categories.${cat}`)}
          onClick={() =>
            // Changing category invalidates the sub-category pick and the
            // §5.7 acknowledgement bound to it.
            update({ category: cat, subCategory: null, aloneAck: false })
          }
        />
      ))}
    </div>
  );
}

export function StepSubCategory({ draft, update }: StepProps) {
  const { t } = useTranslation();
  if (!draft.category) return null;
  return (
    <div>
      {getSubCategories(draft.category).map((def) => (
        <OptionButton
          key={def.key}
          selected={draft.subCategory === def.key}
          title={t(`subcategories.${def.key}`)}
          onClick={() => update({ subCategory: def.key, aloneAck: false })}
        />
      ))}
      {/* §5.4: kids' entertainment gets the explicit "is this childcare?"
          interstitial with the way OUT to sync-sit (decision 20 permits
          out-links; only the reverse direction is gated). */}
      {draft.subCategory === 'party_kids_entertainment' && (
        <InfoBanner variant="warning" className="mt-2">
          {t('family.post.childcareInterstitial')}{' '}
          <a href={SIT_APP_URL} className="font-semibold text-brand-600 underline">
            {t('family.post.childcareInterstitialLink')}
          </a>
        </InfoBanner>
      )}
    </div>
  );
}

export function StepAdultPresent({ draft, update }: StepProps) {
  const { t } = useTranslation();
  const def = draft.subCategory ? getSubCategoryDef(draft.subCategory) : undefined;
  const aloneHome = draft.subCategory !== null && ALONE_HOME_SUBCATEGORIES.includes(draft.subCategory);
  const options: { value: AdultPresence; label: string }[] = [
    { value: 'yes', label: t('family.post.adultPresentYes') },
    { value: 'partly', label: t('family.post.adultPresentPartly') },
    { value: 'no', label: t('family.post.adultPresentNo') },
  ];
  return (
    <div>
      {/* §5's recommendAdultPresent nudge — a nudge, never a gate. The §5.7
          alone-at-home pair deliberately does NOT nudge toward 'yes': for
          them the honest declaration is 'no' plus the acknowledgement. */}
      {def?.flags.recommendAdultPresent && !aloneHome && (
        <InfoBanner className="mb-3">{t('family.post.adultPresentRecommended')}</InfoBanner>
      )}
      {options.map((opt) => (
        <OptionButton
          key={opt.value}
          selected={draft.adultPresent === opt.value}
          title={opt.label}
          onClick={() => update({ adultPresent: opt.value })}
        />
      ))}
      {aloneHome && draft.adultPresent === 'no' && (
        <div className="mt-3">
          <Checkbox
            checked={draft.aloneAck}
            onChange={(e) => update({ aloneAck: e.target.checked })}
            label={t('family.post.aloneHomeAck')}
          />
          {!draft.aloneAck && (
            <p className="mt-2 text-xs text-gray-500">{t('family.post.aloneHomeAckRequired')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function StepToolsTransport({ draft, update }: StepProps) {
  const { t } = useTranslation();
  const toolOptions: { value: boolean | null; label: string }[] = [
    { value: true, label: t('family.post.toolsProvidedYes') },
    { value: false, label: t('family.post.toolsProvidedNo') },
    { value: null, label: t('family.post.toolsProvidedUnknown') },
  ];
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700">{t('family.post.toolsProvidedLabel')}</p>
      {toolOptions.map((opt) => (
        <OptionButton
          key={String(opt.value)}
          selected={draft.toolsProvided === opt.value}
          title={opt.label}
          onClick={() => update({ toolsProvided: opt.value })}
        />
      ))}
      <div className="mt-4">
        <Checkbox
          checked={draft.transportNeeded}
          onChange={(e) => update({ transportNeeded: e.target.checked })}
          label={t('family.post.transportNeededLabel')}
        />
      </div>
    </div>
  );
}

export function StepBudget({ draft, update }: StepProps) {
  const { t } = useTranslation();
  const invalid = validateSuggestedBudget(parsedBudget(draft)) !== null;
  return (
    <div>
      <Input
        label={t('family.post.budgetLabel')}
        type="number"
        inputMode="decimal"
        min={DO_PRICE_MIN}
        max={DO_PRICE_MAX}
        value={draft.suggestedBudget}
        onChange={(e) => update({ suggestedBudget: e.target.value })}
        error={
          invalid
            ? t('family.post.budgetError', { min: DO_PRICE_MIN, max: DO_PRICE_MAX })
            : undefined
        }
        hint={t('family.post.budgetHint')}
      />
    </div>
  );
}
