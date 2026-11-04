import {
  CONSENT_VERSION,
  CONSENT_VERSION_ALIASES,
  INITIAL_CONSENT_VERSION,
} from '../constants/config.js';

/**
 * Whether a stored `users/{uid}.consentVersion` denotes the documents
 * currently in force (issue #488 decision 1 -- the re-consent gate).
 *
 * Three things count as current, and the order matters for what a future
 * bump does:
 *   1. exactly `current` (the live CONSENT_VERSION unless a test passes one);
 *   2. one of `current`'s alias labels (CONSENT_VERSION_ALIASES) -- the
 *      per-app labels study and do stamped for the same text before the
 *      scheme was unified. Looked up by the CURRENT version, so bumping
 *      CONSENT_VERSION retires the old aliases without touching this code;
 *   3. nothing stored at all, which is read as INITIAL_CONSENT_VERSION: the
 *      account predates the field and accepted the original documents. That
 *      is current today and stops being current at the first bump -- exactly
 *      the population a bump has to reach.
 *
 * Anything else is stale and the gate fires. Pure; the callable and the three
 * AuthGuards share it so client and server cannot disagree about staleness.
 */
export function isCurrentConsentVersion(
  stored: string | null | undefined,
  current: string = CONSENT_VERSION,
): boolean {
  const effective = stored ?? INITIAL_CONSENT_VERSION;
  if (effective === current) return true;
  return (CONSENT_VERSION_ALIASES[current] ?? []).includes(effective);
}

/** The gate's one question, phrased for a `users` doc (or its absence). */
export function needsReconsent(
  user: { consentVersion?: string | null } | null | undefined,
  current: string = CONSENT_VERSION,
): boolean {
  return user != null && !isCurrentConsentVersion(user.consentVersion, current);
}
