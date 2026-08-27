/**
 * In-app notification surface (issue #127, UX F13): which notification types
 * sync-sit LISTS, and where a tap on each one lands.
 *
 * The `notifications` collection is shared by both apps (one recipientUserId
 * query serves sit and study), so the store fetches by recipient and this
 * module filters CLIENT-SIDE to the types this app can present — a study-only
 * notification must never light sit's bell. Guardian/governance types show in
 * BOTH apps (a guardian supervises from either portal).
 *
 * Writer-verified type inventory (apps/functions + packages/shared-functions):
 * - `general` is the in-app doc modifyAppointment writes to the babysitter
 *   (its push payload uses `appointment_modified`); both are listed.
 * - `family_submitted` is kept defensively with no route: today its only
 *   writer targets the `references` collection, not `notifications`.
 * - `guardian_orphaned_minor`, `guardian_conflicting_claim` and
 *   `guardian_claim_identity_mismatch` are EXCLUDED: they are `adminAlerts`
 *   docs, never notifications.
 *
 * Types with a `null` route are listed and mark-read-able but do not navigate.
 */

type SitRole = 'babysitter' | 'parent' | 'admin';

/** Sit-world notification types. */
const SIT_TYPES = [
  'new_request',
  'request_accepted',
  'request_declined',
  'request_cancelled',
  'appointment_cancelled',
  'appointment_modified',
  'reminder',
  'general',
  'reference_received',
  'contact_sharing_request',
  'family_submitted',
  // Published-search inversion (issue #207 PR3): the sitter answering a
  // family's published search, and the family's answer back. Each side lands
  // where its pending/confirmed lists live (sitter dashboard / family
  // appointments page).
  'published_search_contact',
  'published_search_accepted',
  'published_search_declined',
] as const;

/** Guardian/governance types — listed in BOTH apps (scope decision on #127). */
const GUARDIAN_TYPES = [
  'supervision_request',
  'supervision_confirmed',
  'supervision_revoked',
  'guardian_invite_accepted',
  'guardian_mirror',
  'guardian_action',
  'guardian_searchable',
] as const;

/** The types this app's bell counts and its /notifications pages list. */
export const VISIBLE_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  ...SIT_TYPES,
  ...GUARDIAN_TYPES,
]);

// Appointment lifecycle types land where the recipient's request/appointment
// lists live: the babysitter's dashboard (no standalone babysitter page), and
// the family's dedicated /family/appointments page (issue #241 — the dashboard
// now only keeps a summary card that links there).
const APPOINTMENT_TYPES = new Set([
  'new_request',
  'request_accepted',
  'request_declined',
  'request_cancelled',
  'appointment_cancelled',
  'appointment_modified',
  'reminder',
  'general',
  'published_search_contact',
  'published_search_accepted',
  'published_search_declined',
]);

/**
 * Where a tap on a notification of `type` navigates for `role`, or null for
 * mark-read-only types (and for recipients with no matching page — e.g. the
 * kid-side copy of supervision_revoked, which has nothing left to act on).
 */
export function notificationRoute(
  type: string,
  data: Record<string, unknown> | undefined,
  role: SitRole | null | undefined,
): string | null {
  if (role === 'babysitter') {
    if (APPOINTMENT_TYPES.has(type)) return '/babysitter';
    if (type === 'reference_received') return '/babysitter/endorsements';
    if (type === 'contact_sharing_request') return '/babysitter/families';
    // The dashboard hosts the SupervisionRequestCard (accept/decline).
    if (type === 'supervision_request') return '/babysitter';
    return null;
  }

  if (role === 'parent') {
    if (APPOINTMENT_TYPES.has(type)) return '/family/appointments';
    if (
      type === 'supervision_confirmed' ||
      type === 'supervision_revoked' ||
      type === 'guardian_invite_accepted'
    ) {
      return '/family/governance';
    }
    if (type === 'guardian_mirror') {
      // The mirror carries the kid's uid; deep-link the guardian to that
      // child's page when present.
      const childUid = data?.mirroredFrom;
      return typeof childUid === 'string' && childUid
        ? `/family/governance/${childUid}`
        : '/family/governance';
    }
    return null;
  }

  // Admins are not recipients of any current notification type; anything that
  // ever lands stays mark-read-only.
  return null;
}
