import { describe, it, expect } from 'vitest';
import { VISIBLE_NOTIFICATION_TYPES, notificationRoute } from '../notificationRouting';

// Pins the study type→route map shipped for issue #127 (UX F13). A wrong entry
// here is a wrong deep link in production, so the WHOLE map is asserted.
describe('study notificationRouting', () => {
  it('lists exactly the study + guardian types', () => {
    expect([...VISIBLE_NOTIFICATION_TYPES].sort()).toEqual(
      [
        'study_contact_request',
        'study_contact_request_cancelled',
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
        'supervision_request',
        'supervision_confirmed',
        'supervision_revoked',
        'guardian_invite_accepted',
        'guardian_mirror',
        'guardian_action',
        'guardian_searchable',
      ].sort(),
    );
  });

  it('never lists sit-world types', () => {
    for (const t of ['new_request', 'appointment_cancelled', 'reference_received', 'general']) {
      expect(VISIBLE_NOTIFICATION_TYPES.has(t)).toBe(false);
    }
  });

  it.each([
    ['study_contact_request', '/tutor/requests'],
    ['study_contact_request_cancelled', '/tutor/requests'],
    // Since the inversion (issue #207 PR4) a tutor receives these too, when the
    // family answers a request the tutor opened. The parent branch was pinned
    // from the start; the tutor branch was not (issue #214), and an unrouted
    // type still counts in the bell -- a badge whose tap goes nowhere.
    ['study_request_accepted', '/tutor/requests'],
    ['study_request_declined', '/tutor/requests'],
    ['study_session_request', '/tutor/sessions'],
    ['study_session_confirmed', '/tutor/sessions'],
    ['study_session_declined', '/tutor/sessions'],
    ['study_session_cancelled', '/tutor/sessions'],
    ['study_session_reminder', '/tutor/sessions'],
    ['tutor_endorsement_received', '/tutor/endorsements'],
    ['supervision_request', '/tutor'],
    ['guardian_action', null],
    ['guardian_searchable', null],
    ['supervision_revoked', null], // kid-side copy: nothing left to act on
  ] as const)('tutor: %s -> %s', (type, route) => {
    expect(notificationRoute(type, {}, 'tutor')).toBe(route);
  });

  it.each([
    ['study_request_accepted', '/family/requests'],
    ['study_request_declined', '/family/requests'],
    // A tutor answered our published search — Accept/Decline lives there.
    ['study_published_search_contact', '/family/requests'],
    // ...and a tutor withdrawing their own request notifies the family too.
    ['study_contact_request_cancelled', '/family/requests'],
    ['study_session_proposed', '/family/sessions'],
    ['study_session_confirmed', '/family/sessions'],
    ['study_session_declined', '/family/sessions'],
    ['study_session_cancelled', '/family/sessions'],
    ['study_session_reminder', '/family/sessions'],
    ['tutor_endorsement_declined', '/family/endorsements'],
    ['tutor_endorsement_published', '/family/endorsements'],
    ['supervision_confirmed', '/family/governance'],
    ['supervision_revoked', '/family/governance'],
    ['guardian_invite_accepted', '/family/governance'],
    ['guardian_action', null],
    ['guardian_searchable', null],
  ] as const)('parent: %s -> %s', (type, route) => {
    expect(notificationRoute(type, {}, 'parent')).toBe(route);
  });

  it('guardian_mirror deep-links the parent to the mirrored kid when present', () => {
    expect(notificationRoute('guardian_mirror', { mirroredFrom: 'kid1' }, 'parent')).toBe(
      '/family/governance/kid1',
    );
    expect(notificationRoute('guardian_mirror', {}, 'parent')).toBe('/family/governance');
    expect(notificationRoute('guardian_mirror', undefined, 'parent')).toBe('/family/governance');
  });

  it('admin and unknown roles never navigate', () => {
    expect(notificationRoute('study_contact_request', {}, 'admin')).toBeNull();
    expect(notificationRoute('study_contact_request', {}, null)).toBeNull();
    expect(notificationRoute('study_contact_request', {}, undefined)).toBeNull();
  });
});
