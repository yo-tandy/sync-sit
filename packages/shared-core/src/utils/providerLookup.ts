/**
 * Shared identity-lookup matching for sit's `lookupBabysitter` and study's
 * `lookupTutor` (issue #437 — replaces study's opaque personal-code lookup,
 * and hardens sit's to the same match surface: name, email, or phone).
 */

/**
 * Collapses a phone number to its last 9 digits for comparison.
 *
 * There is no phone-normalization convention elsewhere in this repo, and the
 * product is France-only, so this is a deliberately narrow heuristic rather
 * than a general E.164 parser: a French mobile or landline number is 9
 * significant digits after the leading `0` (`06 12 34 56 78`) or `+33`
 * (`+33 6 12 34 56 78`) — comparing the last 9 digits makes both forms equal
 * regardless of spacing, dashes, or country-code prefix.
 */
export function normalizePhoneForMatch(raw: string): string {
  return raw.replace(/\D/g, '').slice(-9);
}

export interface ProviderIdentityCandidate {
  fullName: string;
  email: string;
  ejemEmail: string;
  contactPhone?: string | null;
  whatsapp?: string | null;
}

/**
 * True if `query` identifies `candidate` by name (substring), email/ejemEmail
 * (exact), or phone/WhatsApp (normalized exact — see
 * {@link normalizePhoneForMatch}). Case-insensitive throughout; callers pass
 * `query` already trimmed.
 *
 * The phone comparison only runs when the query itself looks phone-shaped
 * (at least 8 digits) — otherwise a short numeric fragment in a name or email
 * query would spuriously collide with the last-9-digits comparison.
 */
export function matchesProviderIdentity(query: string, candidate: ProviderIdentityCandidate): boolean {
  const q = query.toLowerCase();

  if (candidate.fullName.toLowerCase().includes(q)) return true;
  if (candidate.email.toLowerCase() === q) return true;
  if (candidate.ejemEmail.toLowerCase() === q) return true;

  const qDigits = query.replace(/\D/g, '');
  if (qDigits.length >= 8) {
    const qPhone = normalizePhoneForMatch(query);
    if (candidate.contactPhone && normalizePhoneForMatch(candidate.contactPhone) === qPhone) return true;
    if (candidate.whatsapp && normalizePhoneForMatch(candidate.whatsapp) === qPhone) return true;
  }

  return false;
}
