import type { FirestoreTimestamp } from './common.js';

export type NotificationType =
  // ── sync-sit (the original eight) ──
  | 'new_request'
  | 'request_accepted'
  | 'request_declined'
  | 'request_cancelled'
  | 'revalidation'
  | 'account_deleted'
  | 'reference_submitted'
  | 'general'
  // ── sync-study (issue #298's scope extension: these were written as bare
  //    strings into untyped `.add()` calls — e.g. submitTutorEndorsement.ts —
  //    while the union held only sit's eight, so the union under-described
  //    reality. Typed here retroactively; purely additive, no sender
  //    behavior change.) ──
  | 'study_contact_request'
  | 'study_contact_request_cancelled'
  | 'study_published_search_contact'
  | 'study_request_accepted'
  | 'study_request_declined'
  | 'study_session_request'
  | 'study_session_proposed'
  | 'study_session_confirmed'
  | 'study_session_declined'
  | 'study_session_modified'
  | 'study_session_cancelled'
  | 'study_session_reminder'
  | 'tutor_endorsement_received'
  | 'tutor_endorsement_published'
  | 'tutor_endorsement_declined'
  // ── sync-do (plan §10 — all TWELVE land in this one edit at PR9 so PR11
  //    never reopens the union; the endorsement trio's SENDERS land at PR11
  //    with the surface that emits them.) ──
  | 'task_offer_received'
  | 'task_offer_accepted'
  | 'task_offer_declined'
  | 'task_assigned'
  | 'task_cancelled'
  | 'task_updated'
  | 'task_guardian_approval'
  | 'task_marked_done'
  | 'new_task_matching'
  | 'doer_endorsement_received'
  | 'doer_endorsement_published'
  | 'doer_endorsement_declined';

export interface NotificationDoc {
  notificationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  channels: ('email' | 'push')[];
  emailSent: boolean;
  pushSent: boolean;
  createdAt: FirestoreTimestamp;
}
