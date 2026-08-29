import { describe, it, expect } from 'vitest';
import type { NotificationType } from '../notification.js';

// Union pins for issue #298 (sync-do plan §10, §13 PR9). These are
// compile-time checks made runnable: each `satisfies` clause fails the
// typecheck (and therefore this suite) if a value leaves the union, which is
// exactly the regression the one-edit rule guards — PR11 must never need to
// reopen the union for the endorsement trio, and study's retroactively-typed
// strings must keep compiling.

describe('NotificationType union (issue #298)', () => {
  it('carries all twelve sync-do values — nine task/offer + the PR11 endorsement trio', () => {
    const doTypes = [
      'task_offer_received',
      'task_offer_accepted',
      'task_offer_declined',
      'task_assigned',
      'task_cancelled',
      'task_updated',
      'task_guardian_approval',
      'task_marked_done',
      'new_task_matching',
      'doer_endorsement_received',
      'doer_endorsement_published',
      'doer_endorsement_declined',
    ] as const satisfies readonly NotificationType[];
    expect(doTypes).toHaveLength(12);
    expect(new Set(doTypes).size).toBe(12);
  });

  it("types study's previously-bare notification strings (the #298 scope extension)", () => {
    const studyTypes = [
      'study_contact_request',
      'study_contact_request_cancelled',
      'study_published_search_contact',
      'study_request_accepted',
      'study_request_declined',
      'study_session_request',
      'study_session_proposed',
      'study_session_confirmed',
      'study_session_declined',
      'study_session_modified',
      'study_session_cancelled',
      'study_session_reminder',
      'tutor_endorsement_received',
      'tutor_endorsement_published',
      'tutor_endorsement_declined',
    ] as const satisfies readonly NotificationType[];
    expect(new Set(studyTypes).size).toBe(15);
  });

  it("keeps sit's original eight (additive-only contract)", () => {
    const sitTypes = [
      'new_request',
      'request_accepted',
      'request_declined',
      'request_cancelled',
      'revalidation',
      'account_deleted',
      'reference_submitted',
      'general',
    ] as const satisfies readonly NotificationType[];
    expect(new Set(sitTypes).size).toBe(8);
  });
});
