import { describe, it, expect, vi } from 'vitest';

// Which app brands a guardian mirror's EMAIL (PR #334 round-3 review). The
// push leg has always derived its world from the mirrored notification's
// original type; the email leg did not, so it defaulted to 'sit' — invisible
// until the sync-do entries in EMAIL_PREF_CATEGORY made that default
// reachable with do content.
//
// Only the trigger registration needs mocking: `derivePushWorld` (which this
// helper delegates to) is the real implementation, so a change to the
// world-derivation rules fails here too rather than drifting apart.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('../../config/firebase.js', () => ({ db: {} }));

import { derivePushWorld } from '../../config/push.js';
import { deriveMirrorEmailApp } from '../onNotificationCreated.js';

describe('deriveMirrorEmailApp', () => {
  it("brands every do-world mirror as 'do' — the whole point of the fix", () => {
    for (const type of [
      'task_offer_accepted',
      'task_offer_declined',
      'task_cancelled',
      'task_marked_done',
      'task_updated',
      'task_assigned',
      'task_guardian_approval',
      'new_task_matching',
      'doer_endorsement_received',
    ]) {
      expect(deriveMirrorEmailApp(type)).toBe('do');
    }
  });

  it('leaves every pre-existing sit type on the sit branding it already had', () => {
    for (const type of [
      'new_request',
      'request_accepted',
      'request_declined',
      'request_cancelled',
      'contact_sharing_request',
      'published_search_contact',
      'published_search_accepted',
      'published_search_declined',
    ]) {
      expect(deriveMirrorEmailApp(type)).toBe('sit');
    }
  });

  it("brands every STUDY-world mirror as 'study' (issue #350)", () => {
    // PR #334 pinned these on 'sit' deliberately: rebranding a sibling app's
    // existing mail was not a sync-do PR's call to make. #350 IS that call.
    // A supervising parent's copy of a tutoring event used to arrive as
    // `Sync/Sit <noreply@sync-sit.com>`, footed "Open Sync/Sit", about a
    // session that exists only in Sync/Study.
    for (const type of [
      'study_session_confirmed',
      'study_session_cancelled',
      'study_session_declined',
      'study_session_modified',
      'study_request_accepted',
      'study_request_declined',
      'study_contact_request',
      'tutor_endorsement_received',
    ]) {
      expect(deriveMirrorEmailApp(type)).toBe('study');
    }
  });

  it('agrees with the PUSH leg on every type — one world rule, both legs', () => {
    // The invariant #350 establishes. Before it, a study mirror's push said
    // Sync/Study and its email said Sync/Sit, about the same event.
    for (const type of [
      'study_session_confirmed',
      'tutor_endorsement_received',
      'task_offer_accepted',
      'doer_endorsement_received',
      'new_task_matching',
      'new_request',
      'published_search_contact',
      'something_new',
      '',
    ]) {
      expect(deriveMirrorEmailApp(type), type).toBe(derivePushWorld(type));
    }
  });

  it('falls back to sit for an unknown or empty type', () => {
    expect(deriveMirrorEmailApp('')).toBe('sit');
    expect(deriveMirrorEmailApp('something_new')).toBe('sit');
  });
});
