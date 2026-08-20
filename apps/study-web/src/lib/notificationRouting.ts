/**
 * In-app notification surface (issue #127, UX F13): which notification types
 * sync-study LISTS, and where a tap on each one lands.
 *
 * The `notifications` collection is shared by both apps (one recipientUserId
 * query serves sit and study), so the store fetches by recipient and this
 * module filters CLIENT-SIDE to the types this app can present — a sit-only
 * notification must never light study's bell. Guardian/governance types show
 * in BOTH apps (a guardian supervises from either portal).
 *
 * Writer-verified type inventory (apps/study-functions +
 * packages/shared-functions): every study_* type plus the tutor_endorsement_*
 * trio. `guardian_orphaned_minor`, `guardian_conflicting_claim` and
 * `guardian_claim_identity_mismatch` are EXCLUDED: they are `adminAlerts`
 * docs, never notifications.
 *
 * Types with a `null` route are listed and mark-read-able but do not navigate.
 */

type StudyRole = 'tutor' | 'parent' | 'admin';

/** Study-world notification types. */
const STUDY_TYPES = [
  'study_contact_request',
  'study_contact_request_cancelled',
  // A tutor answered this family's published search (issue #207 PR4) — the
  // family's only in-app signal for the whole feature.
  'study_published_search_contact',
  'study_request_accepted',
  'study_request_declined',
  'study_session_request',
  'study_session_proposed',
  'study_session_confirmed',
  'study_session_declined',
  'study_session_cancelled',
  'study_session_reminder',
  'tutor_endorsement_received',
  'tutor_endorsement_declined',
  'tutor_endorsement_published',
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
  ...STUDY_TYPES,
  ...GUARDIAN_TYPES,
]);

// Session lifecycle types land on the recipient's sessions page.
const SESSION_TYPES = new Set([
  'study_session_request',
  'study_session_proposed',
  'study_session_confirmed',
  'study_session_declined',
  'study_session_cancelled',
  'study_session_reminder',
]);

/**
 * Where a tap on a notification of `type` navigates for `role`, or null for
 * mark-read-only types (and for recipients with no matching page — e.g. the
 * kid-side copy of supervision_revoked, which has nothing left to act on).
 */
export function notificationRoute(
  type: string,
  data: Record<string, unknown> | undefined,
  role: StudyRole | null | undefined,
): string | null {
  if (role === 'tutor') {
    if (type === 'study_contact_request' || type === 'study_contact_request_cancelled') {
      return '/tutor/requests';
    }
    if (SESSION_TYPES.has(type)) return '/tutor/sessions';
    if (type === 'tutor_endorsement_received') return '/tutor/endorsements';
    // The dashboard hosts the SupervisionRequestCard (accept/decline).
    if (type === 'supervision_request') return '/tutor';
    return null;
  }

  if (role === 'parent') {
    if (
      type === 'study_request_accepted' ||
      type === 'study_request_declined' ||
      // Accept/Decline for a tutor-initiated request lives on this page.
      type === 'study_published_search_contact'
    ) {
      return '/family/requests';
    }
    if (SESSION_TYPES.has(type)) return '/family/sessions';
    if (type === 'tutor_endorsement_declined' || type === 'tutor_endorsement_published') {
      return '/family/endorsements';
    }
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

  // Study admins have no portal (AdminInfoPage is public-layout only), so no
  // routes; anything that ever lands stays mark-read-only.
  return null;
}
