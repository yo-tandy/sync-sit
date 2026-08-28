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
 */
export function getConsideration(
  key: string,
  locale: ConsiderationsLocale,
): string | undefined {
  return CONSIDERATIONS[locale][key];
}
