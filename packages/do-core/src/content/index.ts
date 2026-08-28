import { CONSIDERATIONS_EN } from './considerations.en.js';
import { CONSIDERATIONS_FR } from './considerations.fr.js';

export { CONSIDERATIONS_EN } from './considerations.en.js';
export { CONSIDERATIONS_FR } from './considerations.fr.js';

export type ConsiderationsLocale = 'en' | 'fr';

/** Both locales, keyed for lookup by the renderers (§5's three surfaces). */
export const CONSIDERATIONS: Record<
  ConsiderationsLocale,
  Record<string, string>
> = {
  en: CONSIDERATIONS_EN,
  fr: CONSIDERATIONS_FR,
};

/**
 * Resolve one consideration key in a locale. Returns undefined for an
 * unknown key — callers render nothing rather than a broken placeholder.
 *
 * Total on purpose: i18n detectors hand out region-subtagged codes
 * ('fr-FR' from localStorage/navigator — the apps' own
 * `language?.startsWith('fr')` convention exists because of it), so an
 * out-of-union locale degrades to undefined instead of a TypeError in a
 * component tree. `Object.hasOwn` keeps inherited object-prototype keys
 * ('constructor', 'toString') from resolving as content.
 */
export function getConsideration(
  key: string,
  locale: ConsiderationsLocale,
): string | undefined {
  const table: Record<string, string> | undefined = CONSIDERATIONS[locale];
  return table !== undefined && Object.hasOwn(table, key)
    ? table[key]
    : undefined;
}
