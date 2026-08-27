/**
 * Sit's name helpers. `capitalize` and the provider-name form now live in
 * `@ejm/shared-ui` (parity D2, issue #240) so study's cards render the same
 * "Marie DUPONT" idiom; this module re-exports them so sit's existing call
 * sites keep their import path — the copy-then-re-export shape the shared
 * extraction has used throughout.
 */
export { capitalize, formatProviderName } from '@ejm/shared-ui';
import { formatProviderName } from '@ejm/shared-ui';

/**
 * Sit-era name for `formatProviderName`. Kept so the four existing call sites
 * read unchanged; new code should use `formatProviderName` directly.
 */
export const formatBabysitterName = formatProviderName;

/**
 * Format family name: ALL CAPS
 * e.g. "NIV YAARI"
 *
 * Stays sit-local: the 'Family' fallback is sit's own copy, and study has no
 * equivalent surface today.
 */
export function formatFamilyTitle(familyName?: string): string {
  if (!familyName) return 'Family';
  return familyName.toUpperCase();
}
