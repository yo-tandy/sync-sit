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

/** Lower-case and strip diacritics ("Élodie" → "elodie") for name comparison. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Name tokens: split on whitespace, hyphens and apostrophes, folded, non-empty. */
export function nameTokens(s: string): string[] {
  return foldName(s)
    .split(/[\s\-'’]+/)
    .filter((t) => t.length > 0);
}

/**
 * American Soundex of a (folded) token — letters only, 4 characters, e.g.
 * "john" and "jon" are both J500 (issue #558: "Jon" must find John). Returns
 * '' for a token with no ASCII letters.
 */
export function soundex(token: string): string {
  const letters = token.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return '';
  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  };
  const first = letters[0];
  let out = first.toUpperCase();
  let last = codes[first] ?? '';
  for (let i = 1; i < letters.length && out.length < 4; i++) {
    const ch = letters[i];
    const code = codes[ch] ?? '';
    // h and w do not separate same-coded consonants; vowels do.
    if (ch === 'h' || ch === 'w') continue;
    if (code && code !== last) out += code;
    last = code;
  }
  return out.padEnd(4, '0');
}

/**
 * True if every token of the query names a token of the candidate's name —
 * in ANY order (issue #558: "Doe John" finds John Doe) — where a query token
 * matches a name token by prefix ("Do" → "Doe", "jo" → "john") or, for query
 * tokens of three letters or more, by Soundex ("Jon" → "John"). Short tokens
 * stay prefix-only so two letters cannot phonetically collide with half a
 * roster.
 */
export function matchesName(query: string, fullName: string): boolean {
  const qTokens = nameTokens(query);
  if (qTokens.length === 0) return false;
  const nTokens = nameTokens(fullName);
  if (nTokens.length === 0) return false;
  // The whole query as a substring of the whole name still counts
  // ("ie dup" inside "marie dupont"), as it always did.
  if (foldName(fullName).includes(foldName(query).trim())) return true;
  return qTokens.every((q) =>
    nTokens.some((n) => n.startsWith(q) || (q.length >= 3 && soundex(q) === soundex(n))),
  );
}

/**
 * True if `query` identifies `candidate` by name (see {@link matchesName}),
 * email/ejemEmail (exact), or phone/WhatsApp (normalized exact — see
 * {@link normalizePhoneForMatch}). Case- and accent-insensitive on names,
 * case-insensitive on email; callers pass `query` already trimmed.
 *
 * The phone comparison only runs when the query itself looks phone-shaped
 * (at least 8 digits) — otherwise a short numeric fragment in a name or email
 * query would spuriously collide with the last-9-digits comparison. A
 * phone-shaped query is never name-matched either, so "0523423210" cannot
 * prefix-match anything.
 */
export function matchesProviderIdentity(query: string, candidate: ProviderIdentityCandidate): boolean {
  const q = query.toLowerCase();

  if (candidate.email.toLowerCase() === q) return true;
  if (candidate.ejemEmail.toLowerCase() === q) return true;

  const qDigits = query.replace(/\D/g, '');
  if (qDigits.length >= 8) {
    const qPhone = normalizePhoneForMatch(query);
    if (candidate.contactPhone && normalizePhoneForMatch(candidate.contactPhone) === qPhone) return true;
    if (candidate.whatsapp && normalizePhoneForMatch(candidate.whatsapp) === qPhone) return true;
    return false;
  }

  // An email-shaped query that did not match exactly is not a name.
  if (q.includes('@')) return false;

  return matchesName(query, candidate.fullName);
}
