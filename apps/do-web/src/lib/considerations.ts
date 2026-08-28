import { useTranslation } from 'react-i18next';
import {
  getConsideration,
  getSubCategoryDef,
  type ConsiderationsLocale,
} from '@ejm/do-core';

/**
 * Resolve a sub-category's §5 considerations list ("things to cover") in the
 * app's current language. The strings live in do-core's content module
 * (CONSIDERATIONS_EN/FR), not in the app i18n files — they are shared
 * taxonomy content rendered in three places (§5): the posting wizard's
 * description step, the doer's task detail (PR8), and the assigned-task
 * checklist. The locale degrades the way the app's other locale checks do:
 * anything that isn't French reads as English.
 */
export function useConsiderations(subCategoryKey: string | null): string[] {
  const { i18n } = useTranslation();
  if (!subCategoryKey) return [];
  const locale: ConsiderationsLocale = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const def = getSubCategoryDef(subCategoryKey);
  if (!def) return [];
  return def.considerationKeys
    .map((key) => getConsideration(key, locale))
    .filter((s): s is string => s !== undefined);
}
