import { ADMIN_CONFIG_DEFS } from './adminConfigDefs.js';

/** EJM email domain */
export const EJM_DOMAIN = 'ejm.org';

/** Minimum babysitter age */
export const MIN_BABYSITTER_AGE = 15;

/** Max photo upload size in bytes (5 MB) */
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

/**
 * Current consent-document versions. The guardian callables require callers
 * to send versions EQUAL to these (stale consent → invalid-argument), so a
 * bump here forces clients to re-present the documents.
 * NOTE: until issue #415 decision 2, the enrollment flows hardcoded their own
 * consentVersion per app ('1.0' in sit, '2025-12-01' in study, '2026-08-28'
 * in do) instead of reading it from here — see CONSENT_VERSION below, which
 * every enrollment flow now sends instead of a local literal.
 *
 * DELIBERATELY NOT BUMPED BY PR #412, which rewrote the substance of both
 * documents and moved only their "Last updated" date. These constants are the
 * only machinery that can drive the in-app re-consent the documents themselves
 * promise (Privacy §15, Terms §14), and the copy is still awaiting the counsel
 * pass that is the plan's one launch blocker — bumping now would force every
 * user through a re-consent for text about to change again. The bump is part
 * of the counsel-revision PR's definition of done; see
 * `docs/sync-do-project-plan.md` §11.5.
 *
 * Consequence worth naming: with these held at '1.0', requireCurrentConsent
 * (packages/shared-functions/src/guardian/shared.ts) sees nothing stale, so
 * the in-app re-consent Privacy §15 / Terms §14 now promise is NOT delivered
 * for this revision -- no user is notified, and every stored consent record
 * cites '1.0' for text that is not the text they accepted. That gap closes
 * the moment the counsel-revision PR bumps this version.
 */
export const TOS_VERSION = '1.0';
export const PRIVACY_POLICY_VERSION = '1.0';
export const SUPERVISION_AGREEMENT_VERSION = '1.0';

/**
 * All three consent-document versions in one object, for call sites (e.g.
 * the kid-invite consent payload) that need to send or compare the full set
 * together rather than one document at a time.
 */
export const CONSENT_VERSIONS = {
  tos: TOS_VERSION,
  privacy: PRIVACY_POLICY_VERSION,
  supervision: SUPERVISION_AGREEMENT_VERSION,
} as const;

/**
 * The ONE `consentVersion` string every enrollment flow (sit, study, do,
 * cross-app, `enrollStudentIdentity`, `enrollFamily`'s legacy default) sends
 * on the enrollment payload — issue #415 decision 2. Before this constant
 * existed, four flows hardcoded four different literals ('1.0' in sit,
 * '2025-12-01' in study, '2026-08-28' in do) even though all four were
 * presenting the SAME legal text: those dates were app-local labels picked
 * when each app's wizard shipped, not evidence of distinct documents. This
 * constant reconciles them onto TOS_VERSION so there is exactly one value in
 * play going forward.
 *
 * Two things this constant deliberately does NOT do:
 *  - It does not rewrite already-stored `consentVersion` values. A user who
 *    enrolled under study's old '2025-12-01' label (or do's '2026-08-28')
 *    keeps that value in their stored record — the audit trail names the
 *    label that was actually in front of them when they consented, and
 *    rewriting history to make old and new records match would be the fake
 *    re-consent this scheme unification is explicitly not attempting.
 *  - It is not a bump. Bumping TOS_VERSION / PRIVACY_POLICY_VERSION /
 *    SUPERVISION_AGREEMENT_VERSION (and therefore this constant, since it is
 *    derived from them) is a deliberate act coupled to a counsel sign-off on
 *    revised document text — see the block comment above. A version bump
 *    with no re-consent gate reading it is silent: nothing currently
 *    compares a stored `consentVersion` against the live constant outside
 *    `requireCurrentConsent` (guardian/kid-invite only). Building that gate
 *    for the enrollment flows is issue #415 decision 1, tracked as a
 *    follow-up, not part of this change.
 */
export const CONSENT_VERSION = TOS_VERSION;

/** Kid-invite validity window in days (resend resets the clock) */
export const KID_INVITE_VALIDITY_DAYS = ADMIN_CONFIG_DEFS.kidInviteValidityDays.default;

/** Verification code length */
export const VERIFICATION_CODE_LENGTH = 6;

/** Past/rejected appointment visibility in days */
export const PAST_VISIBILITY_DAYS = ADMIN_CONFIG_DEFS.pastVisibilityDays.default;

/** Data retention before soft delete in days */
export const RETENTION_DAYS = 30;

/** Schedule slot duration in minutes */
export const SCHEDULE_SLOT_MINUTES = 15;

/** Number of slots per day (24h / 15min) */
export const SLOTS_PER_DAY = 96;

/** Days of the week */
export const DAYS_OF_WEEK = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/** Paris arrondissements */
export const ARRONDISSEMENTS = [
  '1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e',
  '11e', '12e', '13e', '14e', '15e', '16e', '17e', '18e', '19e', '20e',
] as const;

/** Nearby towns (petite couronne + close suburbs) */
export const NEARBY_TOWNS = [
  'Boulogne-Billancourt',
  'Issy-les-Moulineaux',
  'Vanves',
  'Malakoff',
  'Montrouge',
  'Gentilly',
  'Le Kremlin-Bicêtre',
  'Ivry-sur-Seine',
  'Charenton-le-Pont',
  'Saint-Mandé',
  'Vincennes',
  'Montreuil',
  'Les Lilas',
  'Le Pré-Saint-Gervais',
  'Pantin',
  'Aubervilliers',
  'Saint-Ouen',
  'Saint-Denis',
  'Clichy',
  'Levallois-Perret',
  'Neuilly-sur-Seine',
  'Puteaux',
  'Courbevoie',
  'La Garenne-Colombes',
  'Suresnes',
] as const;

/** All selectable areas */
export const ALL_AREAS = [...ARRONDISSEMENTS, ...NEARBY_TOWNS] as const;

/** Supported languages */
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Compute the valid EJM graduation year range.
 * Before Sep 1: current year to current year + 3.
 * From Sep 1 onwards: current year + 1 to current year + 4.
 */
export function getValidGraduationYears(now: Date = new Date()): number[] {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, so 8 = September
  const twoDigitYear = year % 100;

  if (month >= 8) {
    // September onwards: next school year
    return [twoDigitYear + 1, twoDigitYear + 2, twoDigitYear + 3, twoDigitYear + 4];
  }
  return [twoDigitYear, twoDigitYear + 1, twoDigitYear + 2, twoDigitYear + 3];
}
